import type {
  AfternoonTeaPosterBatchItem,
  AppSettings,
  InputImage,
  TaskParams,
  TaskRecord,
} from '../types'

const AFTERNOON_TEA_BATCH_CONCURRENCY = 2

export interface AfternoonTeaPosterSubmitOptions {
  settingsSnapshot: AppSettings
  paramsSnapshot: TaskParams
  inputImage: InputImage
  batchId: string
  title: string
  prompt: string
  onTaskCreated: (taskId: string) => void
}

export type AfternoonTeaPosterSubmit = (
  options: AfternoonTeaPosterSubmitOptions,
) => Promise<{ taskId: string; task: TaskRecord }>

export interface RunAfternoonTeaPosterBatchOptions {
  coordinator: AfternoonTeaBatchCoordinator
  batchId: string
  items: AfternoonTeaPosterBatchItem[]
  settingsSnapshot: AppSettings
  paramsSnapshot: TaskParams
  inputImage: InputImage
  submit: AfternoonTeaPosterSubmit
  onTaskCreated: (batchId: string, itemId: string, taskId: string) => void
  onItemSetupError: (batchId: string, itemId: string, error: unknown) => void
}

export interface RetryAfternoonTeaPosterItemOptions {
  coordinator: AfternoonTeaBatchCoordinator
  batchId: string
  item: AfternoonTeaPosterBatchItem
  settingsSnapshot: AppSettings
  paramsSnapshot: TaskParams
  inputImage: InputImage
  submit: AfternoonTeaPosterSubmit
  onTaskCreated?: (batchId: string, itemId: string, taskId: string) => void
  onItemSetupError?: (batchId: string, itemId: string, error: unknown) => void
}

export class AfternoonTeaBatchCoordinator {
  private activeBatchId: string | null = null
  private readonly startedBatchIds = new Set<string>()
  private readonly terminalBatchIds = new Set<string>()
  private retryInProgress = false
  private disposed = false

  start(batchId: string) {
    this.ensureAvailable()
    if (this.hasActiveWork()) throw new Error('批次正在运行')
    if (this.startedBatchIds.has(batchId)) throw new Error('批次不能重复启动')
    if (this.retryInProgress) throw new Error('重试正在进行')
    this.startedBatchIds.add(batchId)
    this.activeBatchId = batchId
  }

  finish(batchId: string) {
    if (this.disposed || this.activeBatchId !== batchId) return
    this.terminalBatchIds.add(batchId)
  }

  accepts(batchId: string) {
    return !this.disposed && this.activeBatchId === batchId
  }

  hasActiveWork() {
    return this.activeBatchId !== null && !this.terminalBatchIds.has(this.activeBatchId)
  }

  isTerminal(batchId: string) {
    return this.terminalBatchIds.has(batchId)
  }

  hasRetryInProgress() {
    return this.retryInProgress
  }

  beginRetry(batchId: string) {
    this.ensureAvailable()
    if (this.hasActiveWork()) throw new Error('批次仍有任务运行')
    if (!this.accepts(batchId) || !this.isTerminal(batchId)) throw new Error('批次不可重试')
    if (this.retryInProgress) throw new Error('重试正在进行')
    this.retryInProgress = true
  }

  finishRetry() {
    this.retryInProgress = false
  }

  dispose() {
    this.disposed = true
    this.retryInProgress = false
  }

  private ensureAvailable() {
    if (this.disposed) throw new Error('协调器已释放')
  }
}

export async function runAfternoonTeaPosterBatch({
  coordinator,
  batchId,
  items,
  settingsSnapshot,
  paramsSnapshot,
  inputImage,
  submit,
  onTaskCreated,
  onItemSetupError,
}: RunAfternoonTeaPosterBatchOptions) {
  coordinator.start(batchId)
  let cursor = 0
  let hasCallbackFailure = false
  let callbackFailure: unknown

  const worker = async () => {
    while (coordinator.accepts(batchId) && cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      try {
        await submit({
          settingsSnapshot,
          paramsSnapshot,
          inputImage,
          batchId,
          title: item.title,
          prompt: item.prompt,
          onTaskCreated: (taskId) => {
            if (coordinator.accepts(batchId)) onTaskCreated(batchId, item.id, taskId)
          },
        })
      } catch (error) {
        if (coordinator.accepts(batchId)) {
          try {
            onItemSetupError(batchId, item.id, error)
          } catch (callbackError) {
            if (!hasCallbackFailure) {
              hasCallbackFailure = true
              callbackFailure = callbackError
            }
          }
        }
      }
    }
  }

  const results = await Promise.allSettled(
    Array.from({ length: AFTERNOON_TEA_BATCH_CONCURRENCY }, () => worker()),
  )
  coordinator.finish(batchId)
  if (hasCallbackFailure) throw callbackFailure
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}

export async function retryAfternoonTeaPosterItem({
  coordinator,
  batchId,
  item,
  settingsSnapshot,
  paramsSnapshot,
  inputImage,
  submit,
  onTaskCreated,
  onItemSetupError,
}: RetryAfternoonTeaPosterItemOptions) {
  coordinator.beginRetry(batchId)
  try {
    return await submit({
      settingsSnapshot,
      paramsSnapshot,
      inputImage,
      batchId,
      title: item.title,
      prompt: item.prompt,
      onTaskCreated: (taskId) => {
        if (onTaskCreated && coordinator.accepts(batchId)) onTaskCreated(batchId, item.id, taskId)
      },
    })
  } catch (error) {
    if (onItemSetupError && coordinator.accepts(batchId)) onItemSetupError(batchId, item.id, error)
    throw error
  } finally {
    coordinator.finishRetry()
  }
}
