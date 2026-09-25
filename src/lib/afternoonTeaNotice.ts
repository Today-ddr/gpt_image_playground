import {
  AFTERNOON_TEA_NOTICE_DRAFT_STORAGE_KEY,
  AFTERNOON_TEA_NOTICE_STYLE_LABELS,
  AFTERNOON_TEA_NOTICE_STYLES,
  AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT_STORAGE_KEY,
  DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT,
  type AfternoonTeaNoticeStyleLabel,
} from './afternoonTeaNoticePrompts'

export const AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE = '下午茶通知结果格式无效'
export const AFTERNOON_TEA_NOTICE_INCOMPLETE_MENU_MESSAGE = '通知没有把菜单里的菜品写全，请再生成一次'

export type AfternoonTeaNotice = {
  style: string
  text: string
}

export type AfternoonTeaNoticeMenuSegment = {
  displayName: string
}

export type AfternoonTeaNoticeDraft = {
  menuText: string
  brand: string
  notices: AfternoonTeaNotice[]
  selectedIndex: number
  sourceChannel: string
  sourceModel: string
}

export type AfternoonTeaNoticeStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

const POSITION_PREFIX = /^(?:左上|右上|左下|右下|上边|下边|左边|右边|上面|下面|上|下|左|右)\s*[:：]?\s*/
const COUNT_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

export function validateAfternoonTeaNoticeInput(menuText: string) {
  if (!menuText.trim()) throw new Error('请填写今日菜单')
}

function formatRequestedStyles() {
  return AFTERNOON_TEA_NOTICE_STYLES.map((style, index) => (
    `${index + 1}. ${style.label}：${style.description}`
  )).join('\n')
}

export function buildAfternoonTeaNoticeUserPrompt(
  menuText: string,
  brand: string,
  segments?: readonly AfternoonTeaNoticeMenuSegment[] | null,
) {
  const normalizedMenu = menuText.trim()
  const normalizedBrand = brand.trim()
  const brandLine = normalizedBrand
    ? [
      `补充信息：${normalizedBrand}`,
      '用补充信息判断这批是什么。品类例子：奶茶、汉堡包。品牌例子：霸王茶姬、麦当劳。霸王茶姬、喜茶按茶饮理解，麦当劳按汉堡理解。开场和款数行跟这个品类走：填了汉堡包就写汉堡，不要写成肉饼或肉饼拼盘。菜名仍以菜单为准，不要编造没有的单品。',
    ].join('\n')
    : '补充信息：（未提供。不要编造品牌或品类，按菜名本身写。）'
  const locked = segments?.length
    ? [
      '锁定条目（行数、顺序、加号都已确定，清单必须按这个顺序覆盖）：',
      ...segments.map((segment, index) => `${index + 1}. ${segment.displayName}`),
      '只去掉行首位置词，菜名里的字不要删。套餐字母是否保留由你判断，四张卡共用这一份清单。',
    ]
    : ['这段菜单没有分行。请先提取真实食品或饮品，再写成清单。不要编造菜单里没有的菜。']

  return [
    '今日菜单：',
    normalizedMenu,
    '',
    brandLine,
    '',
    ...locked,
    '',
    '本次必须写出 4 张菜单卡，style 必须分别是：',
    formatRequestedStyles(),
    '四张卡共用同一份 itemsIntro、itemLines 和 tip。opening 和 closing 各 1 到 2 行，彼此不要重复。',
    '表情要丰富：开场、款数行、每一条菜、收尾都带贴合食物的 emoji。四张卡的密度要接近，不要整张卡只有一两个表情。',
  ].join('\n')
}

function extractJsonSource(text: string) {
  const source = text.trim()
  const exactFence = source.match(/^```json\s*\n([\s\S]*?)\n```$/)
  if (exactFence?.[1]) return exactFence[1]
  const embeddedFence = source.match(/```json\s*\n([\s\S]*?)\n```/)
  if (embeddedFence?.[1]) return embeddedFence[1]
  return source
}

function isNoticeStyleLabel(value: string): value is AfternoonTeaNoticeStyleLabel {
  return AFTERNOON_TEA_NOTICE_STYLE_LABELS.includes(value as AfternoonTeaNoticeStyleLabel)
}

function nonEmptyLines(value: string) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function compactMenuText(value: string) {
  return value.replace(/\s*[+＋]\s*/g, '+').replace(/\s+/g, '')
}

/** 行首位置词只用于摆盘，不参与菜名核对 */
function coreName(displayName: string) {
  return compactMenuText(displayName.replace(POSITION_PREFIX, ''))
}

function sharedEdge(values: string[], mode: 'prefix' | 'suffix') {
  if (values.length < 2) return ''
  let edge = values[0]
  for (const value of values.slice(1)) {
    let index = 0
    const limit = Math.min(edge.length, value.length)
    while (index < limit) {
      const edgeChar = mode === 'prefix' ? edge[index] : edge[edge.length - 1 - index]
      const valueChar = mode === 'prefix' ? value[index] : value[value.length - 1 - index]
      if (edgeChar !== valueChar) break
      index += 1
    }
    edge = mode === 'prefix' ? edge.slice(0, index) : edge.slice(edge.length - index)
    if (edge.length < 2) return ''
  }
  return edge
}

function remainderAfterShared(core: string, shared: string) {
  if (core.startsWith(shared)) return core.slice(shared.length)
  if (core.endsWith(shared)) return core.slice(0, core.length - shared.length)
  return ''
}

function lineCoversGroup(line: string, cores: string[]) {
  const normalizedLine = compactMenuText(line)
  if (cores.every((core) => normalizedLine.includes(core))) return true
  if (cores.length < 2 || cores.some((core) => core.includes('+'))) return false
  const prefix = sharedEdge(cores, 'prefix')
  const suffix = sharedEdge(cores, 'suffix')
  const shared = prefix.length >= suffix.length ? prefix : suffix
  if (shared.length < 2 || !normalizedLine.includes(shared)) return false
  return cores.every((core) => {
    const rest = remainderAfterShared(core, shared)
    return rest.length > 0 && normalizedLine.includes(rest)
  })
}

function itemLinesCoverLockedItems(itemLines: string[], lockedNames: readonly string[]) {
  const cores = lockedNames.map(coreName).filter(Boolean)
  let index = 0
  for (const line of itemLines) {
    let matched = 0
    for (let size = cores.length - index; size >= 1; size -= 1) {
      if (lineCoversGroup(line, cores.slice(index, index + size))) {
        matched = size
        break
      }
    }
    if (matched === 0) return false
    index += matched
  }
  return index === cores.length
}

function parseCountToken(token: string) {
  if (/^\d+$/.test(token)) {
    const value = Number(token)
    return Number.isInteger(value) ? value : null
  }
  if (token === '两') return 2
  if (token === '十') return 10
  if (token.startsWith('十')) {
    const ones = COUNT_DIGITS[token.slice(1)]
    return token.length === 2 && ones != null ? 10 + ones : null
  }
  const tenIndex = token.indexOf('十')
  if (tenIndex >= 0) {
    const tensToken = token.slice(0, tenIndex)
    const onesToken = token.slice(tenIndex + 1)
    const tens = tensToken === '两' ? 2 : COUNT_DIGITS[tensToken]
    if (tens == null || tensToken.length !== 1) return null
    if (!onesToken) return tens * 10
    const ones = COUNT_DIGITS[onesToken]
    return onesToken.length === 1 && ones != null ? tens * 10 + ones : null
  }
  return token.length === 1 ? COUNT_DIGITS[token] ?? null : null
}

function introMatchesItemCount(intro: string, count: number) {
  const match = intro.match(/(\d{1,2}|[零一二三四五六七八九十两]{1,3})\s*[款种组]/)
  if (!match?.[1]) return false
  return parseCountToken(match[1]) === count
}

function cleanItemLine(line: string) {
  return line.trim().replace(/^(?:▫️|・|•|-|－)\s*/, '')
}

function assembleAfternoonTeaNoticeCard(input: {
  opening: string
  itemsIntro: string
  itemLines: string[]
  tip: string
  closing: string
}) {
  const list = [input.itemsIntro.trim(), ...input.itemLines.map((line) => `▫️${line}`)].join('\n')
  const tip = input.tip.trim()
  return [input.opening.trim(), list, ...(tip ? [tip] : []), input.closing.trim()].join('\n\n')
}

export function parseAfternoonTeaNoticeResult(
  text: string,
  segments?: readonly AfternoonTeaNoticeMenuSegment[] | null,
): AfternoonTeaNotice[] {
  let value: unknown
  try {
    value = JSON.parse(extractJsonSource(text))
  } catch {
    throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  }

  const record = value as {
    itemsIntro?: unknown
    itemLines?: unknown
    tip?: unknown
    notices?: unknown
  }
  if (typeof record.itemsIntro !== 'string' || !record.itemsIntro.trim()) {
    throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  }
  if (!Array.isArray(record.itemLines) || record.itemLines.length === 0) {
    throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  }
  const itemLines = record.itemLines.map((line) => {
    if (typeof line !== 'string') throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    const cleaned = cleanItemLine(line)
    if (!cleaned) throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    return cleaned
  })
  if (record.tip != null && typeof record.tip !== 'string') {
    throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  }
  if (!introMatchesItemCount(record.itemsIntro, itemLines.length)) {
    throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  }
  if (segments?.length && !itemLinesCoverLockedItems(itemLines, segments.map((segment) => segment.displayName))) {
    throw new Error(AFTERNOON_TEA_NOTICE_INCOMPLETE_MENU_MESSAGE)
  }
  if (!Array.isArray(record.notices)) {
    throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  }

  const cards = new Map<AfternoonTeaNoticeStyleLabel, { opening: string; closing: string }>()
  for (const item of record.notices) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    }
    const card = item as { style?: unknown; opening?: unknown; closing?: unknown }
    if (typeof card.style !== 'string' || typeof card.opening !== 'string' || typeof card.closing !== 'string') {
      throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    }
    const style = card.style.trim()
    const openingLines = nonEmptyLines(card.opening)
    const closingLines = nonEmptyLines(card.closing)
    const shapeOk = openingLines.length >= 1 && openingLines.length <= 2
      && closingLines.length >= 1 && closingLines.length <= 2
    if (!isNoticeStyleLabel(style) || cards.has(style) || !shapeOk) {
      throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    }
    cards.set(style, {
      opening: openingLines.join('\n'),
      closing: closingLines.join('\n'),
    })
  }
  if (cards.size !== AFTERNOON_TEA_NOTICE_STYLE_LABELS.length) {
    throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  }

  const tip = typeof record.tip === 'string' ? record.tip : ''
  return AFTERNOON_TEA_NOTICE_STYLE_LABELS.map((style) => {
    const card = cards.get(style)
    if (!card) throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    return {
      style,
      text: assembleAfternoonTeaNoticeCard({
        opening: card.opening,
        itemsIntro: record.itemsIntro as string,
        itemLines,
        tip,
        closing: card.closing,
      }),
    }
  })
}

export function applyAfternoonTeaNoticeText(
  notices: AfternoonTeaNotice[],
  index: number,
  text: string,
) {
  if (!Number.isInteger(index) || index < 0 || index >= notices.length) return notices
  if (notices[index].text === text) return notices
  return notices.map((notice, noticeIndex) => (
    noticeIndex === index ? { ...notice, text } : notice
  ))
}

export function resolveAfternoonTeaNoticeSelectedIndex(notices: AfternoonTeaNotice[], selectedIndex: number) {
  if (notices.length === 0) return 0
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= notices.length) return 0
  return selectedIndex
}

export function getAfternoonTeaNoticePrimaryActionLabel(
  status: AfternoonTeaNoticeStatus,
  noticeCount: number,
) {
  if (status === 'running') return '取消'
  if (noticeCount > 0) return '再生成'
  return '生成通知'
}

export function createEmptyAfternoonTeaNoticeDraft(): AfternoonTeaNoticeDraft {
  return {
    menuText: '',
    brand: '',
    notices: [],
    selectedIndex: 0,
    sourceChannel: '',
    sourceModel: '',
  }
}

function readStorageItem(key: string, storage: StorageReader | null) {
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function writeStorageItem(key: string, value: string, storage: StorageWriter | null) {
  if (!storage) return
  try {
    storage.setItem(key, value)
  } catch {
    // ignore quota / private mode failures
  }
}

function readNoticeList(value: unknown): AfternoonTeaNotice[] {
  if (!Array.isArray(value)) return []
  const notices: AfternoonTeaNotice[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as { style?: unknown; text?: unknown }
    const style = typeof record.style === 'string' ? record.style.trim() : ''
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    if (!style || !text) continue
    notices.push({ style, text })
  }
  return notices
}

export function readAfternoonTeaNoticeDraft(
  storage: StorageReader | null = typeof window === 'undefined' ? null : window.localStorage,
): AfternoonTeaNoticeDraft {
  const raw = readStorageItem(AFTERNOON_TEA_NOTICE_DRAFT_STORAGE_KEY, storage)
  if (!raw) return createEmptyAfternoonTeaNoticeDraft()

  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return createEmptyAfternoonTeaNoticeDraft()
    }
    const record = value as {
      menuText?: unknown
      brand?: unknown
      notices?: unknown
      selectedIndex?: unknown
      sourceChannel?: unknown
      sourceModel?: unknown
    }
    const notices = readNoticeList(record.notices)
    return {
      menuText: typeof record.menuText === 'string' ? record.menuText : '',
      brand: typeof record.brand === 'string' ? record.brand : '',
      sourceChannel: typeof record.sourceChannel === 'string' ? record.sourceChannel : '',
      sourceModel: typeof record.sourceModel === 'string' ? record.sourceModel : '',
      notices,
      selectedIndex: resolveAfternoonTeaNoticeSelectedIndex(
        notices,
        typeof record.selectedIndex === 'number' ? record.selectedIndex : 0,
      ),
    }
  } catch {
    return createEmptyAfternoonTeaNoticeDraft()
  }
}

export function writeAfternoonTeaNoticeDraft(
  draft: AfternoonTeaNoticeDraft,
  storage: StorageWriter | null = typeof window === 'undefined' ? null : window.localStorage,
) {
  writeStorageItem(AFTERNOON_TEA_NOTICE_DRAFT_STORAGE_KEY, JSON.stringify({
    menuText: draft.menuText,
    brand: draft.brand,
    notices: draft.notices,
    sourceChannel: draft.sourceChannel.trim(),
    sourceModel: draft.sourceModel.trim(),
    selectedIndex: resolveAfternoonTeaNoticeSelectedIndex(draft.notices, draft.selectedIndex),
  }), storage)
}

export function readAfternoonTeaNoticeSystemPrompt(
  storage: StorageReader | null = typeof window === 'undefined' ? null : window.localStorage,
) {
  const raw = readStorageItem(AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT_STORAGE_KEY, storage)
  if (raw && isStaleAfternoonTeaNoticeSystemPrompt(raw)) {
    return DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT
  }
  return raw ?? DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT
}

function isStaleAfternoonTeaNoticeSystemPrompt(raw: string) {
  if (raw.includes('不要每行都堆 emoji')) return true
  if (raw.includes('没填品牌就不要编造品牌')) return true
  if (raw.includes('【表情密度】') && raw.includes('【补充信息】')) return false
  if (raw.includes('【菜单卡】')) return false
  if (raw.includes('6 条必须一眼能看出不同')) return true
  if (raw.includes('【目标骨架】')) return true
  if (raw.includes('你是公司下午茶群通知文案助手')) return true
  if (raw.includes('你是公司行政人员')) return true
  if (raw.includes('4 条必须风格不同') && raw.includes('可爱活泼、清单安利、轻松催领、简洁清新')) return true
  return false
}

export function writeAfternoonTeaNoticeSystemPrompt(
  value: string,
  storage: StorageWriter | null = typeof window === 'undefined' ? null : window.localStorage,
) {
  writeStorageItem(AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT_STORAGE_KEY, value, storage)
}
