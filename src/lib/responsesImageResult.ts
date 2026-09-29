import type { ResponsesOutputItem } from '../types'
import { fetchImageUrlAsDataUrl, isDataUrl, isHttpUrl, normalizeBase64Image } from './imageApiShared'

export type ResponsesImageResultSource =
  | { kind: 'b64'; value: string }
  | { kind: 'url'; value: string }

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function classifyImageValue(value: unknown): ResponsesImageResultSource | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (isHttpUrl(trimmed) || isDataUrl(trimmed)) return { kind: 'url', value: trimmed }
  return { kind: 'b64', value: trimmed }
}

const RESULT_VALUE_KEYS = ['b64_json', 'base64', 'image', 'data', 'url', 'image_url'] as const

export function getResponsesImageResultSource(result: ResponsesOutputItem['result']): ResponsesImageResultSource | null {
  if (typeof result === 'string') return classifyImageValue(result)
  if (!isRecordValue(result)) return null

  for (const key of RESULT_VALUE_KEYS) {
    const source = classifyImageValue(result[key])
    if (source) return source
  }
  return null
}

export async function resolveResponsesImageResultDataUrl(
  result: ResponsesOutputItem['result'],
  fallbackMime: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const source = getResponsesImageResultSource(result)
  if (!source) return null
  if (source.kind === 'url') return fetchImageUrlAsDataUrl(source.value, fallbackMime, signal)
  return normalizeBase64Image(source.value, fallbackMime)
}

export function mergeResponsesOutputItem(existing: ResponsesOutputItem, next: ResponsesOutputItem): ResponsesOutputItem {
  const merged: ResponsesOutputItem = { ...existing, ...next }
  // completed 快照常带空 result，不能盖掉前面 output_item.done 已经拿到的图
  if (!getResponsesImageResultSource(next.result) && getResponsesImageResultSource(existing.result)) {
    merged.result = existing.result
  }
  return merged
}

export function upsertResponsesOutputItems(
  outputItems: ResponsesOutputItem[],
  items: ResponsesOutputItem[],
  outputIndices?: Array<number | undefined>,
): void {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const outputIndex = outputIndices?.[i]
    let index = item.id ? outputItems.findIndex((existing) => existing.id === item.id) : -1
    if (index < 0 && !item.id && typeof outputIndex === 'number' && outputIndex >= 0 && outputIndex < outputItems.length) {
      const candidate = outputItems[outputIndex]
      if (candidate?.type === item.type) index = outputIndex
    }
    if (index < 0 && !item.id && item.type) {
      const sameTypeIndices = outputItems
        .map((existing, idx) => existing.type === item.type ? idx : -1)
        .filter((idx) => idx >= 0)
      if (sameTypeIndices.length === 1) index = sameTypeIndices[0]
    }
    if (index >= 0) outputItems[index] = mergeResponsesOutputItem(outputItems[index], item)
    else outputItems.push(item)
  }
}

export function getImageGenerationItemFromEvent(event: Record<string, unknown>): ResponsesOutputItem | null {
  const item = event.item
  if (isRecordValue(item) && (item.type === 'image_generation_call' || item.result != null)) {
    return {
      ...(item as ResponsesOutputItem),
      type: typeof item.type === 'string' ? item.type : 'image_generation_call',
    }
  }

  const result = event.result
  const itemId = typeof event.item_id === 'string' && event.item_id ? event.item_id : undefined
  if (typeof result === 'string' || isRecordValue(result)) {
    return {
      id: itemId,
      type: 'image_generation_call',
      result: result as ResponsesOutputItem['result'],
    }
  }
  return null
}
