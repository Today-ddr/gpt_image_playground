import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AfternoonTeaConversation } from '../types'
import { deleteImage, getAllTasks } from './db'

interface TestRequest<T = unknown> {
  result: T
  error: DOMException | null
  onsuccess: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  onupgradeneeded?: ((event: Event) => void) | null
}

interface TestTransaction {
  objectStore: (name: string) => {
    getAll: () => TestRequest<unknown[]>
    put: (value: { id: string }) => TestRequest<string>
    clear: () => TestRequest<undefined>
  }
  oncomplete: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
  error: Error | null
}

function request<T>(result: T): TestRequest<T> {
  return {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  }
}

function installIndexedDB(existingStores: string[]) {
  const createdStores: Array<{ name: string; keyPath: string | string[] | null }> = []
  const getAllRequest = request<unknown[]>([])
  const tx = {
    objectStore: vi.fn(() => ({ getAll: vi.fn(() => getAllRequest) })),
  }
  const db = {
    objectStoreNames: {
      contains: (name: string) => existingStores.includes(name),
    },
    createObjectStore: vi.fn((name: string, opts: IDBObjectStoreParameters = {}) => {
      createdStores.push({ name, keyPath: opts.keyPath ?? null })
      return {} as IDBObjectStore
    }),
    transaction: vi.fn(() => tx),
  }
  const openRequest = request(db) as TestRequest<typeof db> & {
    onupgradeneeded: ((event: Event) => void) | null
  }
  openRequest.onupgradeneeded = null
  const open = vi.fn(() => {
    queueMicrotask(() => {
      const event = { target: openRequest } as unknown as Event
      openRequest.onupgradeneeded?.(event)
      openRequest.onsuccess?.(event)
      queueMicrotask(() => getAllRequest.onsuccess?.({ target: getAllRequest } as unknown as Event))
    })
    return openRequest
  })
  vi.stubGlobal('indexedDB', { open })
  return { createdStores, open }
}

function installConversationIndexedDB() {
  const records = new Map<string, AfternoonTeaConversation>()
  let latestTransaction: TestTransaction | null = null
  const db = {
    objectStoreNames: { contains: (name: string) => ['tasks', 'images', 'thumbnails', 'agentConversations', 'afternoonTeaConversations'].includes(name) },
    createObjectStore: vi.fn(),
    transaction: vi.fn(() => {
      const tx: TestTransaction = {
        objectStore: (name) => {
          if (name !== 'afternoonTeaConversations') throw new Error(`unexpected store: ${name}`)
          return {
            getAll: () => {
              const req = request([...records.values()])
              queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event))
              return req
            },
            put: (value) => {
              records.set(value.id, value as AfternoonTeaConversation)
              const req = request(value.id)
              queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event))
              return req
            },
            clear: () => {
              records.clear()
              const req = request(undefined)
              queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event))
              return req
            },
          }
        },
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
      }
      latestTransaction = tx
      return tx
    }),
  }
  const openRequest = request(db) as TestRequest<typeof db> & {
    onupgradeneeded: ((event: Event) => void) | null
  }
  openRequest.onupgradeneeded = null
  const open = vi.fn(() => {
    queueMicrotask(() => openRequest.onsuccess?.({ target: openRequest } as unknown as Event))
    return openRequest
  })
  vi.stubGlobal('indexedDB', { open })
  return {
    getLatestTransaction: () => latestTransaction,
    records,
    transaction: db.transaction,
  }
}

function installDeferredDeleteIndexedDB() {
  const imageDelete = vi.fn()
  const thumbnailDelete = vi.fn()
  const tx = {
    objectStore: vi.fn((name: string) => ({
      delete: name === 'images' ? imageDelete : thumbnailDelete,
    })),
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    error: null as Error | null,
  }
  const db = {
    transaction: vi.fn(() => {
      queueMicrotask(() => tx.oncomplete?.())
      return tx
    }),
  }
  const openRequest = request(db)
  const open = vi.fn(() => openRequest)
  vi.stubGlobal('indexedDB', { open })
  return {
    imageDelete,
    open: () => openRequest.onsuccess?.({ target: openRequest } as unknown as Event),
    thumbnailDelete,
    transaction: db.transaction,
  }
}

function conversation(id: string): AfternoonTeaConversation {
  return { id } as AfternoonTeaConversation
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('IndexedDB schema', () => {
  it('upgrades to version 4 by creating only the missing afternoon tea conversation store', async () => {
    const existingStores = ['tasks', 'images', 'thumbnails', 'agentConversations']
    const indexedDB = installIndexedDB(existingStores)

    await getAllTasks()

    expect(indexedDB.open).toHaveBeenCalledWith('gpt-image-playground', 4)
    expect(indexedDB.createdStores).toEqual([
      { name: 'afternoonTeaConversations', keyPath: 'id' },
    ])
  })
})

describe('image deletion guard', () => {
  it('rechecks after opening IndexedDB and skips the transaction when the image became referenced', async () => {
    const indexedDB = installDeferredDeleteIndexedDB()
    let referenced = false

    const deletion = deleteImage('image-a', () => !referenced)
    referenced = true
    indexedDB.open()

    await expect(deletion).resolves.toBe(false)
    expect(indexedDB.transaction).not.toHaveBeenCalled()
    expect(indexedDB.imageDelete).not.toHaveBeenCalled()
    expect(indexedDB.thumbnailDelete).not.toHaveBeenCalled()
  })
})

describe('Afternoon Tea conversation persistence', () => {
  it('puts, reads, and clears conversations through the dedicated store', async () => {
    const indexedDB = installConversationIndexedDB()
    const db = await import('./db')
    const first = conversation('first')

    await db.putAfternoonTeaConversation(first)
    expect(await db.getAllAfternoonTeaConversations()).toEqual([first])

    await db.clearAfternoonTeaConversations()
    expect(await db.getAllAfternoonTeaConversations()).toEqual([])
    expect(indexedDB.records.size).toBe(0)
  })

  it('resolves replace only after the single readwrite transaction completes', async () => {
    const indexedDB = installConversationIndexedDB()
    const db = await import('./db')
    await db.putAfternoonTeaConversation(conversation('old'))
    indexedDB.transaction.mockClear()

    let settled = false
    const replacement = db.replaceAfternoonTeaConversations([
      conversation('new-a'),
      conversation('new-b'),
    ]).then(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(indexedDB.transaction).toHaveBeenCalledTimes(1)
    expect(indexedDB.transaction).toHaveBeenCalledWith('afternoonTeaConversations', 'readwrite')
    expect([...indexedDB.records.keys()]).toEqual(['new-a', 'new-b'])
    expect(indexedDB.getLatestTransaction()).not.toBeNull()
    expect(indexedDB.getLatestTransaction()?.oncomplete).toBeTypeOf('function')
    expect(indexedDB.getLatestTransaction()?.onerror).toBeTypeOf('function')
    expect(indexedDB.getLatestTransaction()?.onabort).toBeTypeOf('function')
    indexedDB.getLatestTransaction()?.oncomplete?.()

    await replacement
    expect(settled).toBe(true)
    expect(await db.getAllAfternoonTeaConversations()).toEqual([
      conversation('new-a'),
      conversation('new-b'),
    ])
  })

  it.each(['error', 'abort'] as const)('rejects replace when the transaction %s', async (event) => {
    const indexedDB = installConversationIndexedDB()
    const db = await import('./db')
    const replacement = db.replaceAfternoonTeaConversations([conversation('new')])
    await Promise.resolve()
    await Promise.resolve()
    const tx = indexedDB.getLatestTransaction()
    expect(tx).not.toBeNull()
    tx!.error = new Error(`${event} failure`)

    const eventPromise = event === 'error' ? tx!.onerror?.() : tx!.onabort?.()
    await expect(Promise.all([replacement, Promise.resolve(eventPromise)])).rejects.toThrow(`${event} failure`)
  })
})
