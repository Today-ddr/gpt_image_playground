import type { AfternoonTeaConversation, AfternoonTeaOrderResult, AfternoonTeaPosterBatchItem, TaskRecord } from '../types'
import { DEFAULT_DISH_TITLE_COUNT } from './dishAnalysisPrompts'

const DEFAULT_CONVERSATION_TITLE = '新下午茶会话'
const MAX_TITLE_COUNT = 10

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTimestamp(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeAfternoonTeaTitleCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DISH_TITLE_COUNT
  return Math.max(1, Math.min(MAX_TITLE_COUNT, Math.floor(value)))
}

function normalizeOrderResult(value: unknown): AfternoonTeaOrderResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const result = value as Partial<AfternoonTeaOrderResult>
  const titles = Array.isArray(result.titles)
    ? [...new Set(result.titles.map(normalizeString).filter(Boolean))]
    : []
  const items = Array.isArray(result.items)
    ? result.items.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const displayName = normalizeString((item as Partial<AfternoonTeaOrderResult['items'][number]>).displayName)
        if (!displayName) return []
        const tags = Array.isArray((item as Partial<AfternoonTeaOrderResult['items'][number]>).tags)
          ? [...new Set((item as Partial<AfternoonTeaOrderResult['items'][number]>).tags?.map(normalizeString).filter(Boolean))]
          : []
        return [{ displayName, tags }]
      })
    : []

  return titles.length > 0 && items.length > 0 ? { titles, items } : null
}

function normalizePosterItems(value: unknown): AfternoonTeaPosterBatchItem[] {
  if (!Array.isArray(value)) return []

  const itemIds = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Partial<AfternoonTeaPosterBatchItem>
    const id = normalizeString(record.id)
    const title = normalizeString(record.title)
    const prompt = normalizeString(record.prompt)
    if (!id || itemIds.has(id) || !title || !prompt) return []
    itemIds.add(id)

    const taskId = normalizeString(record.taskId)
    const setupError = normalizeString(record.setupError)
    return [{
      id,
      title,
      prompt,
      ...(taskId ? { taskId } : {}),
      ...(setupError ? { setupError } : {}),
    }]
  })
}

export function normalizeAfternoonTeaConversations(value: unknown, now = Date.now()): AfternoonTeaConversation[] {
  if (!Array.isArray(value)) return []

  const ids = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Partial<AfternoonTeaConversation>
    const id = normalizeString(record.id)
    if (!id || ids.has(id)) return []
    ids.add(id)

    const createdAt = normalizeTimestamp(record.createdAt, now)
    const sourceImageId = normalizeString(record.sourceImageId)
    return [{
      id,
      title: normalizeString(record.title) || DEFAULT_CONVERSATION_TITLE,
      createdAt,
      updatedAt: normalizeTimestamp(record.updatedAt, now),
      sourceImageId: sourceImageId || null,
      sourceImageName: normalizeString(record.sourceImageName),
      orderText: typeof record.orderText === 'string' ? record.orderText : '',
      titleCount: normalizeAfternoonTeaTitleCount(record.titleCount),
      systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : '',
      analysisSystemPromptSnapshot: typeof record.analysisSystemPromptSnapshot === 'string' ? record.analysisSystemPromptSnapshot : null,
      analysisUserPromptSnapshot: typeof record.analysisUserPromptSnapshot === 'string' ? record.analysisUserPromptSnapshot : null,
      orderResult: normalizeOrderResult(record.orderResult),
      posterItems: normalizePosterItems(record.posterItems),
      batchStartedAt: typeof record.batchStartedAt === 'number' && Number.isFinite(record.batchStartedAt) ? record.batchStartedAt : null,
      batchFinishedAt: typeof record.batchFinishedAt === 'number' && Number.isFinite(record.batchFinishedAt) ? record.batchFinishedAt : null,
    }]
  })
}

export function isEmptyAfternoonTeaConversation(conversation: AfternoonTeaConversation) {
  return !conversation.sourceImageId
    && !conversation.sourceImageName.trim()
    && !conversation.orderText.trim()
    && !conversation.orderResult
    && conversation.posterItems.length === 0
    && conversation.batchStartedAt == null
    && conversation.batchFinishedAt == null
}

export function canReuseRecentEmptyAfternoonTeaConversation(
  conversation: AfternoonTeaConversation | null,
  now: number,
  maxAgeMs: number,
) {
  if (!conversation || !isEmptyAfternoonTeaConversation(conversation)) return false
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return false
  const age = now - conversation.updatedAt
  return age >= 0 && age <= maxAgeMs
}

export function getAfternoonTeaConversationSearchText(conversation: AfternoonTeaConversation) {
  const orderResult = conversation.orderResult
  return [
    conversation.title,
    conversation.sourceImageName,
    conversation.orderText,
    ...(orderResult?.titles ?? []),
    ...(orderResult?.items.flatMap((item) => [item.displayName, ...item.tags]) ?? []),
    ...conversation.posterItems.map((item) => item.title),
  ].filter(Boolean).join('\n')
}

export function collectAfternoonTeaConversationSourceImageIds(conversations: AfternoonTeaConversation[]) {
  const ids = new Set<string>()
  for (const conversation of conversations) {
    if (conversation.sourceImageId) ids.add(conversation.sourceImageId)
  }
  return [...ids]
}

export function getAfternoonTeaConversationBatchElapsed(conversation: AfternoonTeaConversation, tasks: TaskRecord[]) {
  if (conversation.batchStartedAt == null || conversation.batchFinishedAt == null) return null
  return Math.max(0, conversation.batchFinishedAt - conversation.batchStartedAt)
}

export function reconcileAfternoonTeaConversationBatch(
  conversation: AfternoonTeaConversation,
  tasks: TaskRecord[],
  now = Date.now(),
  options: { interruptUnclaimed?: boolean } = {},
) {
  if (conversation.batchStartedAt == null || conversation.batchFinishedAt != null || conversation.posterItems.length === 0) {
    return conversation
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const posterItems = options.interruptUnclaimed
    ? conversation.posterItems.map((item) => item.taskId || item.setupError
      ? item
      : { ...item, setupError: '上次批次已中断' })
    : conversation.posterItems
  const allTerminal = posterItems.every((item) => {
    if (item.setupError) return true
    if (!item.taskId) return false
    const task = tasksById.get(item.taskId)
    return !task || task.status === 'done' || task.status === 'error'
  })
  if (!allTerminal) {
    return posterItems === conversation.posterItems ? conversation : { ...conversation, posterItems }
  }

  const finishedAt = posterItems.reduce((latest, item) => {
    const taskFinishedAt = item.taskId ? tasksById.get(item.taskId)?.finishedAt : null
    return taskFinishedAt == null ? latest : Math.max(latest, taskFinishedAt)
  }, 0) || now
  return {
    ...conversation,
    posterItems,
    batchFinishedAt: finishedAt,
  }
}
