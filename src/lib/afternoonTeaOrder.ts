import type { AfternoonTeaOrderResult } from '../types'

const INVALID_RESULT_MESSAGE = '下午茶订单解析结果格式无效'

export function parseAfternoonTeaOrderResult(text: string, expectedTitleCount: number): AfternoonTeaOrderResult {
  const source = text.trim()
  const match = source.match(/^```json\s*\n([\s\S]*?)\n```$/)

  let value: unknown
  try {
    value = JSON.parse(match ? match[1] : source)
  } catch {
    throw new Error(INVALID_RESULT_MESSAGE)
  }

  if (!Number.isInteger(expectedTitleCount) || expectedTitleCount < 1) {
    throw new Error(INVALID_RESULT_MESSAGE)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(INVALID_RESULT_MESSAGE)
  }

  const result = value as Record<string, unknown>
  if (!Array.isArray(result.titles) || !Array.isArray(result.items) || result.items.length === 0) {
    throw new Error(INVALID_RESULT_MESSAGE)
  }
  if (!result.titles.every((title) => typeof title === 'string')) {
    throw new Error(INVALID_RESULT_MESSAGE)
  }

  const titles = result.titles.map((title) => title.trim())
  if (
    titles.length !== expectedTitleCount
    || titles.some((title) => !title)
    || new Set(titles).size !== titles.length
  ) {
    throw new Error(INVALID_RESULT_MESSAGE)
  }

  const items = result.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(INVALID_RESULT_MESSAGE)
    }

    const record = item as Record<string, unknown>
    if (typeof record.displayName !== 'string' || !record.displayName.trim()) {
      throw new Error(INVALID_RESULT_MESSAGE)
    }
    if (!Array.isArray(record.tags) || !record.tags.every((tag) => typeof tag === 'string')) {
      throw new Error(INVALID_RESULT_MESSAGE)
    }

    return {
      displayName: record.displayName.trim(),
      tags: [...new Set(record.tags.map((tag) => tag.trim()).filter(Boolean))],
    }
  })

  return { titles, items }
}
