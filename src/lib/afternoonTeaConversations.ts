import type { AfternoonTeaConversation, AfternoonTeaOrderResult, AfternoonTeaPosterBatchItem, TaskRecord, AfternoonTeaTitleRegion } from '../types'
import { DEFAULT_DISH_TITLE_COUNT } from './dishAnalysisPrompts'
import { normalizeAfternoonTeaItemTitleRegions } from './afternoonTeaTitlePlacement'
import { rebuildAfternoonTeaPosterItemPrompts } from './afternoonTeaPosterPromptBuilder'

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

    const rawTaskIds = Array.isArray(record.taskIds)
      ? record.taskIds.map(normalizeString).filter(Boolean)
      : []
    const taskIdFromField = normalizeString(record.taskId)
    const taskIds: string[] = []
    const seenTaskIds = new Set<string>()
    for (const candidate of rawTaskIds) {
      if (!candidate || seenTaskIds.has(candidate)) continue
      seenTaskIds.add(candidate)
      taskIds.push(candidate)
    }
    const taskId = taskIdFromField || taskIds[0] || ''
    if (taskId && taskIds.length && !seenTaskIds.has(taskId)) {
      taskIds.unshift(taskId)
    }
    const setupError = normalizeString(record.setupError)
    return [{
      id,
      title,
      prompt,
      ...(taskId ? { taskId } : {}),
      ...(taskIds.length ? { taskIds } : {}),
      ...(setupError ? { setupError } : {}),
    }]
  })
}


/** 收集海报条目关联的全部任务 id（兼容旧单 taskId） */
export function getAfternoonTeaPosterItemTaskIds(item: Pick<AfternoonTeaPosterBatchItem, 'taskId' | 'taskIds'>): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const candidate of [...(item.taskIds ?? []), ...(item.taskId ? [item.taskId] : [])]) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    ids.push(candidate)
  }
  return ids
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
    const orderResult = normalizeOrderResult(record.orderResult)
    const batchStartedAt = typeof record.batchStartedAt === 'number' && Number.isFinite(record.batchStartedAt) ? record.batchStartedAt : null
    const batchFinishedAt = typeof record.batchFinishedAt === 'number' && Number.isFinite(record.batchFinishedAt) ? record.batchFinishedAt : null
    const posterItems = normalizePosterItems(record.posterItems)
    const itemTitleRegionCount = orderResult?.items.length
      ?? (Array.isArray(record.itemTitleRegions) ? record.itemTitleRegions.length : 0)
    const itemTitleRegions = normalizeAfternoonTeaItemTitleRegions(record.itemTitleRegions, itemTitleRegionCount)
    return [{
      id,
      title: normalizeString(record.title) || DEFAULT_CONVERSATION_TITLE,
      createdAt,
      updatedAt: normalizeTimestamp(record.updatedAt, now),
      sourceImageId: sourceImageId || null,
      sourceImageName: normalizeString(record.sourceImageName),
      orderText: typeof record.orderText === 'string' ? record.orderText : '',
      titleCount: normalizeAfternoonTeaTitleCount(record.titleCount),
      itemTitleRegions,
      systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : '',
      analysisSystemPromptSnapshot: typeof record.analysisSystemPromptSnapshot === 'string' ? record.analysisSystemPromptSnapshot : null,
      analysisUserPromptSnapshot: typeof record.analysisUserPromptSnapshot === 'string' ? record.analysisUserPromptSnapshot : null,
      analysisElapsed: orderResult && typeof record.analysisElapsed === 'number' && Number.isFinite(record.analysisElapsed) && record.analysisElapsed >= 0
        ? record.analysisElapsed
        : null,
      orderResult,
      posterItems: orderResult && batchStartedAt == null && batchFinishedAt == null
        ? rebuildAfternoonTeaPosterItemPrompts(orderResult, posterItems, itemTitleRegions, { resetClaims: true })
        : posterItems,
      batchStartedAt,
      batchFinishedAt,
    }]
  })
}

export function createAfternoonTeaItemTitleRegionsPatch(
  conversation: AfternoonTeaConversation,
  itemTitleRegions: AfternoonTeaTitleRegion[],
): Pick<AfternoonTeaConversation, 'itemTitleRegions' | 'posterItems'> | null {
  if (isAfternoonTeaConversationFrozen(conversation) || !conversation.orderResult) return null
  const normalizedRegions = normalizeAfternoonTeaItemTitleRegions(itemTitleRegions, conversation.orderResult.items.length)
  return {
    itemTitleRegions: normalizedRegions,
    posterItems: rebuildAfternoonTeaPosterItemPrompts(conversation.orderResult, conversation.posterItems, normalizedRegions, { resetClaims: true }),
  }
}

export function createAfternoonTeaOrderItemNamePatch(
  conversation: AfternoonTeaConversation,
  index: number,
  displayName: string,
): Pick<AfternoonTeaConversation, 'orderResult' | 'posterItems'> | null {
  if (isAfternoonTeaConversationFrozen(conversation) || !conversation.orderResult) return null
  if (!Number.isInteger(index) || index < 0 || index >= conversation.orderResult.items.length) return null
  const normalizedName = displayName.trim()
  if (!normalizedName) return null
  const orderResult = {
    ...conversation.orderResult,
    items: conversation.orderResult.items.map((item, itemIndex) => itemIndex === index
      ? { ...item, displayName: normalizedName }
      : item),
  }
  return {
    orderResult,
    posterItems: rebuildAfternoonTeaPosterItemPrompts(orderResult, conversation.posterItems, conversation.itemTitleRegions, { resetClaims: true }),
  }
}

export function createAfternoonTeaOrderItemTagsPatch(
  conversation: AfternoonTeaConversation,
  index: number,
  tags: string[],
): Pick<AfternoonTeaConversation, 'orderResult' | 'posterItems'> | null {
  if (isAfternoonTeaConversationFrozen(conversation) || !conversation.orderResult) return null
  if (!Number.isInteger(index) || index < 0 || index >= conversation.orderResult.items.length) return null
  const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
  const currentTags = conversation.orderResult.items[index].tags
  if (normalizedTags.length === currentTags.length && normalizedTags.every((tag, tagIndex) => tag === currentTags[tagIndex])) return null
  const orderResult = {
    ...conversation.orderResult,
    items: conversation.orderResult.items.map((item, itemIndex) => itemIndex === index
      ? { ...item, tags: normalizedTags }
      : item),
  }
  return {
    orderResult,
    posterItems: rebuildAfternoonTeaPosterItemPrompts(orderResult, conversation.posterItems, conversation.itemTitleRegions, { resetClaims: true }),
  }
}

export function createAfternoonTeaOrderTitlePatch(
  conversation: AfternoonTeaConversation,
  index: number,
  title: string,
): Pick<AfternoonTeaConversation, 'orderResult' | 'posterItems'> | null {
  if (isAfternoonTeaConversationFrozen(conversation) || !conversation.orderResult) return null
  if (!Number.isInteger(index) || index < 0 || index >= conversation.orderResult.titles.length) return null
  return createAfternoonTeaOrderTitlesPatch(
    conversation,
    conversation.orderResult.titles.map((currentTitle, titleIndex) => titleIndex === index ? title : currentTitle),
  )
}

export function createAfternoonTeaOrderTitlesPatch(
  conversation: AfternoonTeaConversation,
  titles: string[],
): Pick<AfternoonTeaConversation, 'orderResult' | 'posterItems'> | null {
  if (isAfternoonTeaConversationFrozen(conversation) || !conversation.orderResult) return null
  if (titles.length !== conversation.orderResult.titles.length) return null
  const normalizedTitles = titles.map((title) => title.trim())
  if (normalizedTitles.some((title) => !title) || new Set(normalizedTitles).size !== normalizedTitles.length) return null
  const orderResult = {
    ...conversation.orderResult,
    titles: normalizedTitles,
  }
  return {
    orderResult,
    posterItems: rebuildAfternoonTeaPosterItemPrompts(orderResult, conversation.posterItems, conversation.itemTitleRegions, { resetClaims: true }),
  }
}

export function isAfternoonTeaConversationFrozen(
  conversation: Pick<AfternoonTeaConversation, 'batchStartedAt' | 'batchFinishedAt'> | null | undefined,
): boolean {
  return conversation?.batchStartedAt != null || conversation?.batchFinishedAt != null
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
    ? conversation.posterItems.map((item) => {
      const claimed = getAfternoonTeaPosterItemTaskIds(item).length > 0 || Boolean(item.setupError)
      return claimed ? item : { ...item, setupError: '上次批次已中断' }
    })
    : conversation.posterItems
  const allTerminal = posterItems.every((item) => {
    if (item.setupError) return true
    const taskIds = getAfternoonTeaPosterItemTaskIds(item)
    if (!taskIds.length) return false
    return taskIds.every((taskId) => {
      const task = tasksById.get(taskId)
      return !task || task.status === 'done' || task.status === 'error'
    })
  })
  if (!allTerminal) {
    return posterItems === conversation.posterItems ? conversation : { ...conversation, posterItems }
  }

  const finishedAt = posterItems.reduce((latest, item) => {
    const taskFinishedAts = getAfternoonTeaPosterItemTaskIds(item)
      .map((taskId) => tasksById.get(taskId)?.finishedAt)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (!taskFinishedAts.length) return latest
    return Math.max(latest, ...taskFinishedAts)
  }, 0) || now
  return {
    ...conversation,
    posterItems,
    batchFinishedAt: finishedAt,
  }
}
