import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type AfternoonTeaPosterBatchItem, type AppSettings, type InputImage, type TaskParams, type TaskRecord } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { loadImage } from './canvasImage'
import { normalizeImageSize } from './size'
import {
  AfternoonTeaBatchCoordinator,
  createAfternoonTeaPosterParamsSnapshot,
  readAfternoonTeaPosterSourceSize,
  retryAfternoonTeaPosterItem,
  runAfternoonTeaPosterBatch,
} from './afternoonTeaBatch'

vi.mock('./canvasImage', () => ({
  loadImage: vi.fn(),
}))

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

describe('createAfternoonTeaPosterParamsSnapshot', () => {
  it('derives the poster size from the source image instead of the gallery size', () => {
    const profile = createDefaultOpenAIProfile({ id: 'openai', apiKey: 'secret', model: 'gpt-image-2' })
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    const galleryParams = { ...DEFAULT_PARAMS, size: '1920x1080', n: 4 }

    const snapshot = createAfternoonTeaPosterParamsSnapshot(galleryParams, settings, { width: 3024, height: 4032 })

    expect(snapshot).toMatchObject({
      size: normalizeImageSize('3024x4032'),
      n: 4,
    })
    expect(snapshot.size).not.toBe(galleryParams.size)
    expect(galleryParams.size).toBe('1920x1080')
  })

  it('reads the source natural dimensions before creating a poster snapshot', async () => {
    vi.mocked(loadImage).mockResolvedValueOnce({
      naturalWidth: 3024,
      naturalHeight: 4032,
    } as HTMLImageElement)

    await expect(readAfternoonTeaPosterSourceSize('data:image/jpeg;base64,source'))
      .resolves.toEqual({ width: 3024, height: 4032 })
    expect(loadImage).toHaveBeenCalledWith('data:image/jpeg;base64,source')
  })
})

describe('runAfternoonTeaPosterBatch', () => {
  it('同一轮提交全部项目，并等待全部终态后结束批次', async () => {
    const batchItems = [
      ...items,
      { id: 'item-d', title: '标题 D', prompt: '提示词 D' },
    ]
    const pending = batchItems.map(() => deferred<ReturnType<typeof taskResult>>())
    const calls: Array<{
      settingsSnapshot: AppSettings
      paramsSnapshot: TaskParams
      inputImage: InputImage
      batchId: string
      title: string
      prompt: string
      executionMode?: 'browser' | 'server'
    }> = []
    const created = vi.fn()
    const finished = vi.fn()
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
      items: batchItems,
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      executionMode: 'server',
      submit,
      onTaskCreated: created,
      onItemSetupError: vi.fn(),
      onBatchFinished: finished,
    })
    await flushMicrotasks()

    expect(calls).toHaveLength(batchItems.length)
    expect(maxActive).toBe(batchItems.length)
    expect(calls.map((call) => call.prompt)).toEqual(batchItems.map((item) => item.prompt))
    expect(calls.map((call) => call.title)).toEqual(batchItems.map((item) => item.title))
    expect(calls.every((call) => call.settingsSnapshot === settingsSnapshot)).toBe(true)
    expect(calls.every((call) => call.paramsSnapshot === paramsSnapshot)).toBe(true)
    expect(calls.every((call) => call.inputImage === inputImage)).toBe(true)
    expect(calls.every((call) => call.batchId === 'batch-a')).toBe(true)
    expect(calls.every((call) => call.executionMode === 'server')).toBe(true)
    expect(created.mock.calls).toEqual(batchItems.map((item, idx) => [
      'batch-a',
      item.id,
      `task-${idx}`,
    ]))
    expect(finished).not.toHaveBeenCalled()
    expect(coordinator.isTerminal('batch-a')).toBe(false)

    pending[0].resolve(taskResult('task-0', batchItems[0].prompt))
    await flushMicrotasks()

    expect(finished).not.toHaveBeenCalled()
    expect(coordinator.isTerminal('batch-a')).toBe(false)

    pending.slice(1).forEach((entry, idx) => {
      entry.resolve(taskResult(`task-${idx + 1}`, batchItems[idx + 1].prompt))
    })
    await run

    expect(maxActive).toBe(batchItems.length)
    expect(finished).toHaveBeenCalledOnce()
    expect(finished).toHaveBeenCalledWith('batch-a')
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

  it('task-created callback 抛错时仍尝试全部项目，并最终抛出首个 callback error', async () => {
    const callbackErrors = items.map((item) => new Error(`created callback failed: ${item.id}`))
    let callbackCount = 0
    const submit = vi.fn(async (opts) => {
      opts.onTaskCreated(`task-${opts.prompt}`)
      return taskResult(`task-${opts.prompt}`, opts.prompt)
    })

    const run = runAfternoonTeaPosterBatch({
      coordinator: new AfternoonTeaBatchCoordinator(),
      batchId: 'batch-created-callback-error',
      items,
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit,
      onTaskCreated: () => {
        const error = callbackErrors[callbackCount]
        callbackCount += 1
        throw error
      },
      onItemSetupError: vi.fn(),
    })

    await expect(run).rejects.toBe(callbackErrors[0])
    expect(submit).toHaveBeenCalledTimes(3)
    expect(callbackCount).toBe(3)
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

  it('新批次启动后忽略旧 claim 回调，dispose 后仍交付当前 claim 回调和完成通知', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const created = vi.fn()
    const finished = vi.fn()
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
      onBatchFinished: finished,
    })
    await flushMicrotasks()

    callbacks.old?.('task-stale')
    expect(created).not.toHaveBeenCalled()

    coordinator.dispose()
    callbacks.current?.('task-after-dispose')
    expect(created).toHaveBeenCalledOnce()
    expect(created).toHaveBeenCalledWith('batch-current', 'item-a', 'task-after-dispose')
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
    expect(coordinator.isTerminal('batch-current')).toBe(true)
    expect(finished).toHaveBeenCalledOnce()
    expect(finished).toHaveBeenCalledWith('batch-current')
  })

  it('所有项目提交后 dispose 不会撤销已发出的请求', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const batchItems = [...items, { id: 'item-d', title: '标题 D', prompt: '提示词 D' }]
    const pending = batchItems.map(() => deferred<ReturnType<typeof taskResult>>())
    const submitted: string[] = []
    const run = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-dispose-queue',
      items: batchItems,
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: (opts) => {
        const idx = submitted.length
        submitted.push(opts.prompt)
        return pending[idx].promise
      },
      onTaskCreated: vi.fn(),
      onItemSetupError: vi.fn(),
    })
    await flushMicrotasks()

    expect(submitted).toEqual(batchItems.map((item) => item.prompt))
    coordinator.dispose()
    pending.forEach((entry, idx) => {
      entry.resolve(taskResult(`task-${idx}`, batchItems[idx].prompt))
    })
    await run

    expect(submitted).toEqual(batchItems.map((item) => item.prompt))
  })

  it('in-flight submit 在 dispose 后 reject 时仍触发 setup-error callback 和完成通知', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const pending = deferred<ReturnType<typeof taskResult>>()
    const setupErrors = vi.fn()
    const finished = vi.fn()
    const setupError = new Error('late setup error')
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
      onBatchFinished: finished,
    })
    await flushMicrotasks()

    coordinator.dispose()
    pending.reject(setupError)
    await run

    expect(setupErrors).toHaveBeenCalledOnce()
    expect(setupErrors).toHaveBeenCalledWith('batch-dispose-error', 'item-a', setupError)
    expect(coordinator.isTerminal('batch-dispose-error')).toBe(true)
    expect(finished).toHaveBeenCalledWith('batch-dispose-error')
  })

  it('旧批次 settle 时 active identity 已变化则忽略旧 claim 和 finish callback', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const oldPending = deferred<ReturnType<typeof taskResult>>()
    const currentPending = deferred<ReturnType<typeof taskResult>>()
    const created = vi.fn()
    const oldFinished = vi.fn()
    let oldCreated: ((taskId: string) => void) | undefined
    const oldRun = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-stale-finish',
      items: items.slice(0, 1),
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: (opts) => {
        oldCreated = opts.onTaskCreated
        return oldPending.promise
      },
      onTaskCreated: created,
      onItemSetupError: vi.fn(),
      onBatchFinished: oldFinished,
    })
    await flushMicrotasks()

    coordinator.finish('batch-stale-finish')
    const currentRun = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-new-identity',
      items: items.slice(0, 1),
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: () => currentPending.promise,
      onTaskCreated: vi.fn(),
      onItemSetupError: vi.fn(),
    })
    await flushMicrotasks()

    oldCreated?.('task-too-late')
    oldPending.resolve(taskResult('task-old', items[0].prompt))
    await oldRun

    expect(created).not.toHaveBeenCalled()
    expect(oldFinished).not.toHaveBeenCalled()
    expect(coordinator.isTerminal('batch-new-identity')).toBe(false)

    currentPending.resolve(taskResult('task-current', items[0].prompt))
    await currentRun
  })

  it('finish callback 抛错时仍标记 terminal，并把 callback error 返回给调用方', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const callbackError = new Error('finish callback failed')

    const run = runAfternoonTeaPosterBatch({
      coordinator,
      batchId: 'batch-finish-callback-error',
      items: [],
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: vi.fn(),
      onTaskCreated: vi.fn(),
      onItemSetupError: vi.fn(),
      onBatchFinished: () => {
        throw callbackError
      },
    })

    await expect(run).rejects.toBe(callbackError)
    expect(coordinator.isTerminal('batch-finish-callback-error')).toBe(true)
  })

  it('批次完成只调用唯一的 onBatchFinished callback', async () => {
    const onBatchFinished = vi.fn()
    const onFinished = vi.fn()

    await runAfternoonTeaPosterBatch({
      coordinator: new AfternoonTeaBatchCoordinator(),
      batchId: 'batch-single-finish-callback',
      items: [],
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit: vi.fn(),
      onTaskCreated: vi.fn(),
      onItemSetupError: vi.fn(),
      onBatchFinished,
      // @ts-expect-error onFinished 不是批次完成回调契约
      onFinished,
    })

    expect(onBatchFinished).toHaveBeenCalledOnce()
    expect(onFinished).not.toHaveBeenCalled()
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
    const frozenPrompt = '冻结位置：下方偏左，left=11,top=63,right=48,bottom=84'
    const retryItem = { ...items[1], prompt: frozenPrompt }
    const retryOptions = {
      coordinator,
      batchId: 'batch-retry',
      item: retryItem,
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
      undefined,
    )
    await expect(retryAfternoonTeaPosterItem(retryOptions)).rejects.toThrow('重试正在进行')
    expect(retrySubmit).toHaveBeenCalledTimes(1)
    expect(retrySubmit.mock.calls[0][0]).toMatchObject({
      batchId: 'batch-retry',
      title: items[1].title,
      prompt: frozenPrompt,
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
    })

    retryPending.resolve(taskResult('task-retry-ok', frozenPrompt))
    await firstRetry
    expect(coordinator.hasRetryInProgress()).toBe(false)

    const retryError = new Error('retry setup failed')
    retrySubmit.mockRejectedValueOnce(retryError)
    await expect(retryAfternoonTeaPosterItem(retryOptions)).rejects.toBe(retryError)
    expect(retryOptions.onItemSetupError).toHaveBeenCalledWith('batch-retry', 'item-b', retryError)
    expect(coordinator.hasRetryInProgress()).toBe(false)

    retrySubmit.mockResolvedValueOnce(taskResult('task-retry-after-error', frozenPrompt))
    await expect(retryAfternoonTeaPosterItem(retryOptions)).resolves.toEqual(
      taskResult('task-retry-after-error', frozenPrompt),
    )
    expect(retrySubmit).toHaveBeenCalledTimes(3)
  })

  it('passes profileIds and replaceTaskId when retrying a single relay task', async () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    const batchId = 'batch-single-retry'
    coordinator.finish(batchId, coordinator.start(batchId))
    const submit = vi.fn(async (opts: any) => {
      opts.onTaskCreated('task-new')
      return taskResult('task-new', 'prompt-single')
    })
    const onTaskCreated = vi.fn()
    await retryAfternoonTeaPosterItem({
      coordinator,
      batchId,
      item: { id: 'item-a', title: '标题', prompt: 'prompt-single', taskId: 'task-old', taskIds: ['task-old', 'task-other'] },
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      submit,
      onTaskCreated,
      retryTaskId: 'task-old',
      retryProfileId: 'profile-a',
      retryGenerationGroupId: 'group-1',
    })
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      profileIds: ['profile-a'],
      generationGroupId: 'group-1',
    }))
    expect(onTaskCreated).toHaveBeenCalledWith(batchId, 'item-a', 'task-new', 'task-old')
  })
})
