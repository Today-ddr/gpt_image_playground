import type { AfternoonTeaItem, AfternoonTeaOrderResult } from '../types'
import {
  DEFAULT_AFTERNOON_TEA_TITLE_CANDIDATES,
  uniqueAfternoonTeaTitles,
} from './dishAnalysisPrompts'

const MAX_TITLE_COUNT = 10

/** 备选标题不够时继续补，保证海报最多 10 张仍能各自有标题 */
const EXTRA_TITLE_FALLBACKS = [
  '今日茶点',
  '午后茶点',
  '本周茶歇',
  '今日分享',
  '午后分享',
  '茶歇时光',
  '小食时光',
  '甜品时光',
  '本周小食',
  '今日餐点',
]

const CATEGORY_LINE = /^(?:热食|冷食|饮品|饮料|主食|小食|甜品|点心|汤品|汤类|小菜|水果|套餐|美食)\s*[:：]?$/
const CATEGORY_PREFIX = /^(?:热食|冷食|饮品|饮料|主食|小食|甜品|点心|汤品|汤类|小菜|水果)\s*[:：]\s*/
const WRAPPED_LABEL = /^[（(\[【]\s*(?:套餐\s*)?(?:[A-Za-z]|[0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[）)\]】]\s*/
const INLINE_LABEL = /^(?:套餐\s*)?(?:[A-Za-z]|[0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[:：.、．)\]】]\s*/
const PARENTHETICAL_NOTE = /[（(][^（）()]{0,30}[）)]/g
const TRAILING_QUANTITY = /(?:\s*[*xX×]\s*\d+|\s*\d+\s*[份个只杯瓶盒])\s*$/u
const TRAILING_NOTE = /(?:[，,、]\s*|\s+)(?:少辣|微辣|中辣|特辣|加辣|加冰|少冰|去冰|多冰|常温|热饮|需要配清汤|配清汤|不要葱|不要香菜)\s*$/u

export type AfternoonTeaMenuSegment = {
  displayName: string
}

function clampTitleCount(count: number) {
  if (!Number.isFinite(count)) return 1
  return Math.max(1, Math.min(MAX_TITLE_COUNT, Math.floor(count)))
}

function sameTags(left: string[], right: string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index])
}

/** 去掉序号、数量和括号备注，保留套餐里的加号 */
function cleanMenuItemName(name: string) {
  let text = name.replace(CATEGORY_PREFIX, '').replace(WRAPPED_LABEL, '').replace(INLINE_LABEL, '').trim()
  text = text.replace(PARENTHETICAL_NOTE, '')
  let previous = ''
  while (text !== previous) {
    previous = text
    text = text.replace(TRAILING_QUANTITY, '').replace(TRAILING_NOTE, '')
  }
  return text.replace(/\s*[+＋]\s*/g, '+').replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * 多行菜单一行一个商品。
 * 单行散文返回 null，仍交给模型提取。
 */
export function segmentAfternoonTeaMenu(orderText: string): AfternoonTeaMenuSegment[] | null {
  const lines = orderText.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const labeledSingleLine = lines.length === 1 && (WRAPPED_LABEL.test(lines[0]) || INLINE_LABEL.test(lines[0]))
  if (lines.length < 2 && !labeledSingleLine) return null

  const segments = lines.flatMap((line) => {
    if (CATEGORY_LINE.test(line)) return []
    const displayName = cleanMenuItemName(line)
    return displayName ? [{ displayName }] : []
  })
  return segments.length > 0 ? segments : null
}

/** 用已有标题、备选和内置标题凑够张数，不重新请求模型 */
export function resizeAfternoonTeaTitles(result: AfternoonTeaOrderResult, count: number): AfternoonTeaOrderResult {
  const titleCount = clampTitleCount(count)
  const pool = uniqueAfternoonTeaTitles([
    ...result.titles,
    ...(result.titleCandidates ?? []),
    ...DEFAULT_AFTERNOON_TEA_TITLE_CANDIDATES,
    ...EXTRA_TITLE_FALLBACKS,
  ])
  const titles: string[] = []
  for (const title of pool) {
    if (titles.length >= titleCount) break
    titles.push(title)
  }
  let suffix = 1
  while (titles.length < titleCount && suffix <= MAX_TITLE_COUNT) {
    const generated = `茶歇分享${suffix}`
    suffix += 1
    if (!titles.includes(generated)) titles.push(generated)
  }
  return {
    titles,
    titleCandidates: uniqueAfternoonTeaTitles([...pool, ...titles]),
    items: result.items,
  }
}

function modelAligned(segments: AfternoonTeaMenuSegment[], model: AfternoonTeaOrderResult) {
  return model.items.length === segments.length
}

function tagsForSegment(segments: AfternoonTeaMenuSegment[], model: AfternoonTeaOrderResult, index: number) {
  if (modelAligned(segments, model)) return model.items[index]?.tags ?? []
  const name = segments[index]?.displayName
  const matches = model.items.filter((item) => item.displayName === name)
  return matches.length === 1 ? matches[0].tags : []
}

/** 数量对齐时采用模型整理后的名称；拆多了就退回本地整行，避免加号被拆开 */
function modelDisplayName(segments: AfternoonTeaMenuSegment[], model: AfternoonTeaOrderResult, index: number) {
  if (!modelAligned(segments, model)) return null
  const name = model.items[index]?.displayName?.trim()
  return name || null
}

function mergeSegmentItems(
  segments: AfternoonTeaMenuSegment[],
  model: AfternoonTeaOrderResult,
  current: AfternoonTeaOrderResult | null,
  preliminaryItems: AfternoonTeaItem[] | null,
) {
  const modelTags = segments.map((_, index) => tagsForSegment(segments, model, index))
  const structureChanged = Boolean(
    preliminaryItems
    && current
    && current.items.length !== preliminaryItems.length,
  )
  if (structureChanged && current) {
    return current.items.map((item) => {
      const index = segments.findIndex((segment) => segment.displayName === item.displayName)
      if (index < 0) return item
      const preliminary = preliminaryItems?.[index]
      const renamed = Boolean(preliminary && item.displayName !== preliminary.displayName)
      const displayName = renamed ? item.displayName : (modelDisplayName(segments, model, index) ?? item.displayName)
      if (preliminary && sameTags(item.tags, preliminary.tags)) {
        return { displayName, tags: modelTags[index] ?? item.tags }
      }
      return { ...item, displayName }
    })
  }

  return segments.map((segment, index) => {
    const currentItem = current?.items[index]
    const preliminary = preliminaryItems?.[index]
    const renamed = Boolean(currentItem && preliminary && currentItem.displayName !== preliminary.displayName)
    const displayName = renamed
      ? currentItem.displayName
      : (modelDisplayName(segments, model, index) ?? segment.displayName)
    const tags = currentItem && preliminary && !sameTags(currentItem.tags, preliminary.tags)
      ? currentItem.tags
      : modelTags[index]
    return { displayName, tags }
  })
}

/**
 * 一行一个商品，名称用模型整理后的结果。
 * 模型把一行拆成多个时，退回本地整行。用户改过的标题保留。
 */
export function mergeSegmentedDishAnalysis(input: {
  segments: AfternoonTeaMenuSegment[]
  model: AfternoonTeaOrderResult
  current: AfternoonTeaOrderResult | null
  preliminaryItems: AfternoonTeaItem[] | null
  titleCount: number
  titlesCustomized: boolean
}): AfternoonTeaOrderResult {
  const items = mergeSegmentItems(input.segments, input.model, input.current, input.preliminaryItems)
  if (input.titlesCustomized && input.current) {
    return resizeAfternoonTeaTitles({
      titles: input.current.titles,
      titleCandidates: uniqueAfternoonTeaTitles([
        ...(input.current.titleCandidates ?? []),
        ...input.model.titles,
        ...(input.model.titleCandidates ?? []),
      ]),
      items,
    }, input.current.titles.length)
  }
  return resizeAfternoonTeaTitles({
    titles: input.model.titles,
    titleCandidates: input.model.titleCandidates,
    items,
  }, input.titleCount)
}
