import type {
  AfternoonTeaPosterBatchItem,
  AppSettings,
  InputImage,
  TaskParams,
  TaskRecord,
} from '../types'
import { loadImage } from './canvasImage'
import { normalizeParamsForSettings } from './paramCompatibility'
import { normalizeImageSize } from './size'

export type AfternoonTeaPosterSourceSize = {
  width: number
  height: number
}

export function createAfternoonTeaPosterParamsSnapshot(
  params: TaskParams,
  settings: AppSettings,
  sourceSize: AfternoonTeaPosterSourceSize,
) {
  const width = Math.round(sourceSize.width)
  const height = Math.round(sourceSize.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('无法读取原图尺寸，请重新上传餐品图片')
  }
  return normalizeParamsForSettings({
    ...params,
    size: normalizeImageSize(`${width}x${height}`),
  }, settings, { hasInputImages: true })
}

export async function readAfternoonTeaPosterSourceSize(dataUrl: string): Promise<AfternoonTeaPosterSourceSize> {
  try {
    const image = await loadImage(dataUrl)
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error('图片尺寸无效')
    return { width: image.naturalWidth, height: image.naturalHeight }
  } catch {
    throw new Error('无法读取原图尺寸，请重新上传餐品图片')
  }
}

export interface AfternoonTeaPosterSubmitOptions {
  settingsSnapshot: AppSettings
  paramsSnapshot: TaskParams
  inputImage: InputImage
  batchId: string
  title: string
  prompt: string
  executionMode?: 'browser' | 'server'
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
  executionMode?: 'browser' | 'server'
  submit: AfternoonTeaPosterSubmit
  onTaskCreated: (batchId: string, itemId: string, taskId: string) => void
  onItemSetupError: (batchId: string, itemId: string, error: unknown) => void
  onBatchFinished?: (batchId: string) => void
}

export interface RetryAfternoonTeaPosterItemOptions {
  coordinator: AfternoonTeaBatchCoordinator
  batchId: string
  item: AfternoonTeaPosterBatchItem
  settingsSnapshot: AppSettings
  paramsSnapshot: TaskParams
  inputImage: InputImage
  executionMode?: 'browser' | 'server'
  submit: AfternoonTeaPosterSubmit
  onTaskCreated?: (batchId: string, itemId: string, taskId: string) => void
  onItemSetupError?: (batchId: string, itemId: string, error: unknown) => void
}

export class AfternoonTeaBatchCoordinator {
  private activeBatchId: string | null = null
  private readonly startedBatchIds = new Set<string>()
  private readonly terminalBatchIds = new Set<string>()
  private activeGeneration = 0
  private retryInProgress = false
  private disposed = false

  start(batchId: string) {
    this.ensureAvailable()
    if (this.hasActiveWork()) throw new Error('批次正在运行')
    if (this.startedBatchIds.has(batchId)) throw new Error('批次不能重复启动')
    if (this.retryInProgress) throw new Error('重试正在进行')
    this.startedBatchIds.add(batchId)
    this.activeBatchId = batchId
    this.activeGeneration += 1
    return this.activeGeneration
  }

  finish(batchId: string, generation?: number) {
    if (this.activeBatchId !== batchId) return false
    if (generation !== undefined && this.activeGeneration !== generation) return false
    this.terminalBatchIds.add(batchId)
    return true
  }

  accepts(batchId: string) {
    return !this.disposed && this.activeBatchId === batchId
  }

  claim(batchId: string) {
    if (!this.accepts(batchId)) return null
    return this.activeGeneration
  }

  acceptsClaim(batchId: string, generation: number) {
    return this.activeBatchId === batchId && this.activeGeneration === generation
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
  executionMode,
  submit,
  onTaskCreated,
  onItemSetupError,
  onBatchFinished,
}: RunAfternoonTeaPosterBatchOptions) {
  const batchGeneration = coordinator.start(batchId)
  let hasCallbackFailure = false
  let callbackFailure: unknown

  const recordCallbackFailure = (error: unknown) => {
    if (hasCallbackFailure) return
    hasCallbackFailure = true
    callbackFailure = error
  }

  const results = await Promise.allSettled(
    items.map(async (item) => {
      try {
        await submit({
          settingsSnapshot,
          paramsSnapshot,
          inputImage,
          batchId,
          title: item.title,
          prompt: item.prompt,
          executionMode,
          onTaskCreated: (taskId) => {
            if (!coordinator.acceptsClaim(batchId, batchGeneration)) return
            try {
              onTaskCreated(batchId, item.id, taskId)
            } catch (callbackError) {
              recordCallbackFailure(callbackError)
            }
          },
        })
      } catch (error) {
        if (coordinator.acceptsClaim(batchId, batchGeneration)) {
          try {
            onItemSetupError(batchId, item.id, error)
          } catch (callbackError) {
            recordCallbackFailure(callbackError)
          }
        }
      }
    }),
  )
  if (coordinator.finish(batchId, batchGeneration)) {
    if (onBatchFinished) {
      try {
        onBatchFinished(batchId)
      } catch (callbackError) {
        recordCallbackFailure(callbackError)
      }
    }
  }
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
  executionMode,
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
      executionMode,
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
