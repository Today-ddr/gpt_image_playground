import { describe, expect, it, vi } from 'vitest'
import type { AfternoonTeaPosterBatchItem, AppSettings, InputImage, TaskParams, TaskRecord } from '../types'
import {
  AfternoonTeaBatchCoordinator,
  retryAfternoonTeaPosterItem,
  runAfternoonTeaPosterBatch,
} from './afternoonTeaBatch'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const settingsSnapshot = {} as AppSettings
const paramsSnapshot = { size: 'auto' } as TaskParams
const inputImage: InputImage = { id: 'input-a', dataUrl: 'data:image/png;base64,a' }
const items: AfternoonTeaPosterBatchItem[] = [
  { id: 'item-a', title: '标题 A', prompt: '提示词 A' },
  { id: 'item-b', title: '标题 B', prompt: '提示词 B' },
  { id: 'item-c', title: '标题 C', prompt: '提示词 C' },
]

function taskResult(taskId: string, prompt: string) {
  const task: TaskRecord = {
    id: taskId,
    prompt,
    params: paramsSnapshot,
    inputImageIds: [inputImage.id],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  }
  return { taskId, task }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('runAfternoonTeaPosterBatch', () => {
  it('最多同时提交两项，并等待一项终态后才领取下一项', async () => {
    const pending = items.map(() => deferred<ReturnType<typeof taskResult>>())
    const calls: Array<{
      settingsSnapshot: AppSettings
      paramsSnapshot: TaskParams
      inputImage: InputImage
      batchId: string
      title: string
      prompt: string
    }> = []
    const created = vi.fn()
    let active = 0
    let maxActive = 0
    const submit = vi.fn((opts) => {
      const idx = calls.length
      calls.push(opts)
      active += 1
      maxActive = Math.max(maxActive, active)
      opts.onTaskCreated(`task-${idx}`)
      return pending[idx].promise.finally(() => {
        active -= 1
      })
    })
    const coordinator = new AfternoonTeaBatchCoordinator()

    const run = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-a',
      items,
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit,
      onTaskCreated: created,
      onItemSetupError: vi.fn(),
    })
    await flushMicrotasks()

    expect(calls).toHaveLength(2)
    expect(maxActive).toBe(2)

    pending[0].resolve(taskResult('task-0', items[0].prompt))
    await flushMicrotasks()

    expect(calls).toHaveLength(3)
    expect(calls.map((call) => call.prompt)).toEqual(items.map((item) => item.prompt))
    expect(calls.map((call) => call.title)).toEqual(items.map((item) => item.title))
    expect(calls.every((call) => call.settingsSnapshot === settingsSnapshot)).toBe(true)
    expect(calls.every((call) => call.paramsSnapshot === paramsSnapshot)).toBe(true)
    expect(calls.every((call) => call.inputImage === inputImage)).toBe(true)
    expect(calls.every((call) => call.batchId === 'batch-a')).toBe(true)
    expect(created.mock.calls).toEqual([
      ['batch-a', 'item-a', 'task-0'],
      ['batch-a', 'item-b', 'task-1'],
      ['batch-a', 'item-c', 'task-2'],
    ])

    pending[1].resolve(taskResult('task-1', items[1].prompt))
    pending[2].resolve(taskResult('task-2', items[2].prompt))
    await run

    expect(maxActive).toBe(2)
    expect(coordinator.isTerminal('batch-a')).toBe(true)
    expect(coordinator.hasActiveWork()).toBe(false)
  })

  it('单项 setup 失败后报告对应 item 并继续后续项目', async () => {
    const setupError = new Error('setup failed')
    const errors = vi.fn()
    const submitted: string[] = []
    const submit = vi.fn(async (opts) => {
      submitted.push(opts.prompt)
      if (opts.prompt === '提示词 A') throw setupError
      return taskResult(`task-${opts.prompt}`, opts.prompt)
    })

    await runAfternoonTeaPosterBatch({
      coordinator: new AfternoonTeaBatchCoordinator(),
      batchId: 'batch-partial',
      items,
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit,
      onTaskCreated: vi.fn(),
      onItemSetupError: errors,
    })

    expect(submitted).toEqual(items.map((item) => item.prompt))
    expect(errors).toHaveBeenCalledOnce()
    expect(errors).toHaveBeenCalledWith('batch-partial', 'item-a', setupError)
  })

  it('setup-error callback 抛错时仍尝试全部项目，并在 terminal 后抛出 callback error', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const fiveItems = [
      ...items,
      { id: 'item-d', title: '标题 D', prompt: '提示词 D' },
      { id: 'item-e', title: '标题 E', prompt: '提示词 E' },
    ]
    const callbackErrors = fiveItems.map((item) => new Error(`setup callback failed: ${item.id}`))
    let callbackCount = 0
    const submit = vi.fn(async () => {
      throw new Error('submit failed')
    })

    const run = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-callback-error',
      items: fiveItems,
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit,
      onTaskCreated: vi.fn(),
      onItemSetupError: () => {
        const error = callbackErrors[callbackCount]
        callbackCount += 1
        throw error
      },
    })

    await expect(run).rejects.toBe(callbackErrors[0])
    expect(submit).toHaveBeenCalledTimes(5)
    expect(callbackCount).toBe(5)
    expect(coordinator.isTerminal('batch-callback-error')).toBe(true)
    expect(coordinator.hasActiveWork()).toBe(false)
  })

  it('空批次立即进入 terminal 且不调用 submit', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const submit = vi.fn()

    await runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-empty',
      items: [],
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit,
      onTaskCreated: vi.fn(),
      onItemSetupError: vi.fn(),
    })

    expect(submit).not.toHaveBeenCalled()
    expect(coordinator.isTerminal('batch-empty')).toBe(true)
    expect(coordinator.hasActiveWork()).toBe(false)
  })

  it('拒绝运行中重复 start，并在全部 submit 终态后标记 terminal', async () => {
    const pending = deferred<ReturnType<typeof taskResult>>()
    const coordinator = new AfternoonTeaBatchCoordinator()
    const options = {
      coordinator,
      batchId: 'batch-duplicate',
      items: items.slice(0, 1),
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: () => pending.promise,
      onTaskCreated: vi.fn(),
      onItemSetupError: vi.fn(),
    }

    const firstRun = runAfternoonTeaPosterBatch(options)
    await flushMicrotasks()

    expect(coordinator.hasActiveWork()).toBe(true)
    await expect(runAfternoonTeaPosterBatch(options)).rejects.toThrow('批次正在运行')
    expect(coordinator.isTerminal('batch-duplicate')).toBe(false)

    pending.resolve(taskResult('task-a', '提示词 A'))
    await firstRun

    expect(coordinator.isTerminal('batch-duplicate')).toBe(true)
    await expect(runAfternoonTeaPosterBatch(options)).rejects.toThrow('批次不能重复启动')
  })

  it('新批次启动后忽略旧批次回调，dispose 后忽略回调并拒绝操作', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const created = vi.fn()
    const callbacks: {
      old?: (taskId: string) => void
      current?: (taskId: string) => void
    } = {}
    await runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-old',
      items: items.slice(0, 1),
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: async (opts) => {
        callbacks.old = opts.onTaskCreated
        return taskResult('task-old', opts.prompt)
      },
      onTaskCreated: created,
      onItemSetupError: vi.fn(),
    })

    const pending = deferred<ReturnType<typeof taskResult>>()
    const currentRun = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-current',
      items: items.slice(0, 1),
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: (opts) => {
        callbacks.current = opts.onTaskCreated
        return pending.promise
      },
      onTaskCreated: created,
      onItemSetupError: vi.fn(),
    })
    await flushMicrotasks()

    callbacks.old?.('task-stale')
    expect(created).not.toHaveBeenCalled()

    coordinator.dispose()
    callbacks.current?.('task-after-dispose')
    expect(created).not.toHaveBeenCalled()
    await expect(runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-after-dispose',
      items: [],
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: vi.fn(),
      onTaskCreated: created,
      onItemSetupError: vi.fn(),
    })).rejects.toThrow('协调器已释放')

    pending.resolve(taskResult('task-current', '提示词 A'))
    await currentRun
    expect(coordinator.isTerminal('batch-current')).toBe(false)
  })

  it('dispose 后不再领取队列中尚未开始的项目', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const pending = [
      deferred<ReturnType<typeof taskResult>>(),
      deferred<ReturnType<typeof taskResult>>(),
    ]
    const submitted: string[] = []
    const run = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-dispose-queue',
      items: [...items, { id: 'item-d', title: '标题 D', prompt: '提示词 D' }],
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: (opts) => {
        const idx = submitted.length
        submitted.push(opts.prompt)
        return pending[idx]?.promise ?? Promise.resolve(taskResult(`task-${idx}`, opts.prompt))
      },
      onTaskCreated: vi.fn(),
      onItemSetupError: vi.fn(),
    })
    await flushMicrotasks()

    expect(submitted).toEqual(['提示词 A', '提示词 B'])
    coordinator.dispose()
    pending[0].resolve(taskResult('task-a', '提示词 A'))
    pending[1].resolve(taskResult('task-b', '提示词 B'))
    await run

    expect(submitted).toEqual(['提示词 A', '提示词 B'])
  })

  it('in-flight submit 在 dispose 后 reject 时不触发 setup-error callback', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const pending = deferred<ReturnType<typeof taskResult>>()
    const setupErrors = vi.fn()
    const run = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-dispose-error',
      items: items.slice(0, 1),
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: () => pending.promise,
      onTaskCreated: vi.fn(),
      onItemSetupError: setupErrors,
    })
    await flushMicrotasks()

    coordinator.dispose()
    pending.reject(new Error('late setup error'))
    await run

    expect(setupErrors).not.toHaveBeenCalled()
    expect(coordinator.isTerminal('batch-dispose-error')).toBe(false)
  })
})

describe('retryAfternoonTeaPosterItem', () => {
  it('主批次忙时拒绝 retry；只重提选中项并在 resolve 和 reject 后释放锁', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const batchPending = deferred<ReturnType<typeof taskResult>>()
    const batchRun = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-retry',
      items: items.slice(0, 1),
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: () => batchPending.promise,
      onTaskCreated: vi.fn(),
      onItemSetupError: vi.fn(),
    })
    await flushMicrotasks()

    const retrySubmit = vi.fn()
    const retryOptions = {
      coordinator,
      batchId: 'batch-retry',
      item: items[1],
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: retrySubmit,
      onTaskCreated: vi.fn(),
      onItemSetupError: vi.fn(),
    }
    await expect(retryAfternoonTeaPosterItem(retryOptions)).rejects.toThrow('批次仍有任务运行')
    expect(retrySubmit).not.toHaveBeenCalled()

    batchPending.resolve(taskResult('task-batch', items[0].prompt))
    await batchRun

    const retryPending = deferred<ReturnType<typeof taskResult>>()
    retrySubmit.mockImplementationOnce((opts) => {
      opts.onTaskCreated('task-retry-created')
      return retryPending.promise
    })
    const firstRetry = retryAfternoonTeaPosterItem(retryOptions)
    await flushMicrotasks()

    expect(coordinator.hasRetryInProgress()).toBe(true)
    expect(retryOptions.onTaskCreated).toHaveBeenCalledWith(
      'batch-retry',
      'item-b',
      'task-retry-created',
    )
    await expect(retryAfternoonTeaPosterItem(retryOptions)).rejects.toThrow('重试正在进行')
    expect(retrySubmit).toHaveBeenCalledTimes(1)
    expect(retrySubmit.mock.calls[0][0]).toMatchObject({
      batchId: 'batch-retry',
      title: items[1].title,
      prompt: items[1].prompt,
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
    })

    retryPending.resolve(taskResult('task-retry-ok', items[1].prompt))
    await firstRetry
    expect(coordinator.hasRetryInProgress()).toBe(false)

    const retryError = new Error('retry setup failed')
    retrySubmit.mockRejectedValueOnce(retryError)
    await expect(retryAfternoonTeaPosterItem(retryOptions)).rejects.toBe(retryError)
    expect(retryOptions.onItemSetupError).toHaveBeenCalledWith('batch-retry', 'item-b', retryError)
    expect(coordinator.hasRetryInProgress()).toBe(false)

    retrySubmit.mockResolvedValueOnce(taskResult('task-retry-after-error', items[1].prompt))
    await expect(retryAfternoonTeaPosterItem(retryOptions)).resolves.toEqual(
      taskResult('task-retry-after-error', items[1].prompt),
    )
    expect(retrySubmit).toHaveBeenCalledTimes(3)
  })
})
