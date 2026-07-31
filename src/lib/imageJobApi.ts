import type { ApiProfile, TaskParams } from '../types'

export interface ImageJobSubmission {
  profile: ApiProfile
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
  sendPromptAsIs?: boolean
  allowPromptRewrite?: boolean
}

export type ImageJobStatus = 'running' | 'done' | 'error' | 'interrupted'

export interface ImageJobRecord {
  id: string
  status: ImageJobStatus
  createdAt: number
  startedAt: number
  finishedAt: number | null
  error: string | null
  resultUrls: string[]
  actualParams?: Partial<TaskParams>
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  revisedPrompts?: Array<string | undefined>
  rawImageUrls?: string[]
  failedRequests?: Array<{ requestIndex: number; error: string }>
}

export interface ImageJobExecutionPreference {
  executionMode: 'browser' | 'server'
  requiresConfirmation: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJob(value: unknown): ImageJobRecord {
  if (!isRecord(value)) throw new Error('后台任务响应格式无效')
  if (typeof value.id !== 'string') throw new Error('后台任务响应格式无效')
  if (!['running', 'done', 'error', 'interrupted'].includes(String(value.status))) {
    throw new Error('后台任务响应格式无效')
  }
  if (!Array.isArray(value.resultUrls) || !value.resultUrls.every((url) => typeof url === 'string')) {
    throw new Error('后台任务响应格式无效')
  }
  if (typeof value.createdAt !== 'number' || typeof value.startedAt !== 'number') {
    throw new Error('后台任务响应格式无效')
  }
  if (value.finishedAt !== null && typeof value.finishedAt !== 'number') {
    throw new Error('后台任务响应格式无效')
  }
  if (value.error !== null && typeof value.error !== 'string') {
    throw new Error('后台任务响应格式无效')
  }
  return value as unknown as ImageJobRecord
}

async function getErrorMessage(response: Response) {
  try {
    const payload = await response.json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  } catch {
    // 非 JSON 错误响应使用 HTTP 状态兜底。
  }
  return `后台任务请求失败：HTTP ${response.status}`
}

export async function isImageJobApiAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/api/jobs/health', { cache: 'no-store' })
    if (!response.ok) return false
    const payload = await response.json() as { status?: unknown }
    return payload.status === 'ok'
  } catch {
    return false
  }
}

export async function getImageJobExecutionPreference(): Promise<ImageJobExecutionPreference> {
  if (await isImageJobApiAvailable()) {
    return { executionMode: 'server', requiresConfirmation: false }
  }
  return { executionMode: 'browser', requiresConfirmation: true }
}

export async function submitImageJob(taskId: string, submission: ImageJobSubmission): Promise<ImageJobRecord> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(await getErrorMessage(response))
  return parseJob(await response.json())
}

export async function getImageJob(taskId: string): Promise<ImageJobRecord | null> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(taskId)}`, { cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await getErrorMessage(response))
  return parseJob(await response.json())
}
