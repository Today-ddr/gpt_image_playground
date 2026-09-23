import {
  AFTERNOON_TEA_NOTICE_DRAFT_STORAGE_KEY,
  AFTERNOON_TEA_NOTICE_EMOJI_COUNT,
  AFTERNOON_TEA_NOTICE_EMOJI_STYLE_LABELS,
  AFTERNOON_TEA_NOTICE_PLAIN_COUNT,
  AFTERNOON_TEA_NOTICE_PLAIN_STYLE_LABELS,
  AFTERNOON_TEA_NOTICE_STYLE_LABELS,
  AFTERNOON_TEA_NOTICE_STYLES,
  AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT_STORAGE_KEY,
  DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT,
  type AfternoonTeaNoticeStyleLabel,
} from './afternoonTeaNoticePrompts'

export const AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE = '下午茶通知结果格式无效'

export type AfternoonTeaNotice = {
  style: AfternoonTeaNoticeStyleLabel
  text: string
}

export type AfternoonTeaNoticeDraft = {
  menuText: string
  brand: string
  notices: AfternoonTeaNotice[]
  selectedIndex: number
}

export type AfternoonTeaNoticeStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function validateAfternoonTeaNoticeInput(menuText: string) {
  if (!menuText.trim()) throw new Error('请填写今日菜单')
}

export function shuffleItems<T>(items: readonly T[], random: () => number = Math.random) {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = next[index]
    next[index] = next[swapIndex]
    next[swapIndex] = current
  }
  return next
}

export function pickAfternoonTeaNoticeStyles(
  previousLabels: readonly AfternoonTeaNoticeStyleLabel[] = [],
  options: { random?: () => number } = {},
) {
  const random = options.random ?? Math.random
  const previous = new Set(
    previousLabels.filter((label) => AFTERNOON_TEA_NOTICE_STYLE_LABELS.includes(label)),
  )
  const emojiStyles = pickStylesFromGroup(
    AFTERNOON_TEA_NOTICE_EMOJI_STYLE_LABELS,
    previous,
    AFTERNOON_TEA_NOTICE_EMOJI_COUNT,
    random,
  )
  const plainStyles = pickStylesFromGroup(
    AFTERNOON_TEA_NOTICE_PLAIN_STYLE_LABELS,
    previous,
    AFTERNOON_TEA_NOTICE_PLAIN_COUNT,
    random,
  )
  return shuffleItems([...emojiStyles, ...plainStyles], random)
}

function pickStylesFromGroup(
  labels: readonly AfternoonTeaNoticeStyleLabel[],
  previous: ReadonlySet<AfternoonTeaNoticeStyleLabel>,
  count: number,
  random: () => number,
) {
  const limitedCount = Math.min(Math.max(1, count), labels.length)
  const shuffled = shuffleItems(labels, random)
  const fresh = shuffled.filter((label) => !previous.has(label))
  const reused = shuffled.filter((label) => previous.has(label))
  return [...fresh, ...reused].slice(0, limitedCount)
}

function formatRequestedStyles(styles: readonly AfternoonTeaNoticeStyleLabel[]) {
  return styles.map((label, index) => {
    const style = AFTERNOON_TEA_NOTICE_STYLES.find((item) => item.label === label)
    const description = style?.description ? `：${style.description}` : ''
    const emojiRule = style?.usesEmoji ? '必须使用 emoji' : '禁止使用 emoji'
    return `${index + 1}. ${label}${description}（${emojiRule}）`
  }).join('\n')
}

export function buildAfternoonTeaNoticeUserPrompt(
  menuText: string,
  brand: string,
  styles: readonly AfternoonTeaNoticeStyleLabel[] = [
    ...AFTERNOON_TEA_NOTICE_EMOJI_STYLE_LABELS.slice(0, AFTERNOON_TEA_NOTICE_EMOJI_COUNT),
    ...AFTERNOON_TEA_NOTICE_PLAIN_STYLE_LABELS.slice(0, AFTERNOON_TEA_NOTICE_PLAIN_COUNT),
  ],
) {
  const normalizedMenu = menuText.trim()
  const normalizedBrand = brand.trim()
  const brandLine = normalizedBrand
    ? `品牌：${normalizedBrand}`
    : '品牌：（未提供，不要编造品牌）'
  const requestedStyles = styles.length > 0
    ? styles
    : [
      ...AFTERNOON_TEA_NOTICE_EMOJI_STYLE_LABELS.slice(0, AFTERNOON_TEA_NOTICE_EMOJI_COUNT),
      ...AFTERNOON_TEA_NOTICE_PLAIN_STYLE_LABELS.slice(0, AFTERNOON_TEA_NOTICE_PLAIN_COUNT),
    ]

  return [
    '今日菜单：',
    normalizedMenu,
    '',
    brandLine,
    '',
    `本次必须恰好写出 ${requestedStyles.length} 条通知，style 字段必须分别是：`,
    formatRequestedStyles(requestedStyles),
    `其中恰好 ${AFTERNOON_TEA_NOTICE_EMOJI_COUNT} 条必须带 emoji，${AFTERNOON_TEA_NOTICE_PLAIN_COUNT} 条完全不带 emoji。6 条必须一眼能看出不同：开场、排版、收尾都不要重复。参考例只是口吻，不是填空模板。禁止写成茶水间播报，也禁止只改形容词。禁止输出未指定的风格，也不要漏掉任何指定风格。`,
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

export function parseAfternoonTeaNoticeResult(text: string): AfternoonTeaNotice[] {
  return parseAfternoonTeaNoticeResultForStyles(text)
}

export function parseAfternoonTeaNoticeResultForStyles(
  text: string,
  expectedStyles?: readonly AfternoonTeaNoticeStyleLabel[],
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

  const notices = (value as { notices?: unknown }).notices
  if (!Array.isArray(notices) || notices.length === 0) {
    throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  }

  const noticesByStyle = new Map<AfternoonTeaNoticeStyleLabel, string>()
  for (const item of notices) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    }
    const record = item as { style?: unknown; text?: unknown }
    if (typeof record.style !== 'string' || typeof record.text !== 'string') {
      throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    }
    const style = record.style.trim()
    const noticeText = record.text.trim()
    if (!isNoticeStyleLabel(style) || !noticeText) {
      throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    }
    if (noticesByStyle.has(style)) {
      throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    }
    noticesByStyle.set(style, noticeText)
  }

  if (expectedStyles && expectedStyles.length > 0) {
    if (noticesByStyle.size !== expectedStyles.length) {
      throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    }
    return expectedStyles.map((style) => {
      const noticeText = noticesByStyle.get(style)
      if (!noticeText) throw new Error(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
      return { style, text: noticeText }
    })
  }

  return [...noticesByStyle.entries()].map(([style, noticeText]) => ({ style, text: noticeText }))
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
  try {
    return parseAfternoonTeaNoticeResult(JSON.stringify({ notices: value }))
  } catch {
    return []
  }
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
    }
    const notices = readNoticeList(record.notices)
    return {
      menuText: typeof record.menuText === 'string' ? record.menuText : '',
      brand: typeof record.brand === 'string' ? record.brand : '',
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
  if (raw.includes('【口吻参考】') && raw.includes('6 条必须一眼能看出不同')) return false
  if (raw.includes('【目标骨架】')) return true
  if (raw.includes('你是公司行政人员')) return true
  if (raw.includes('你是公司下午茶群通知文案助手')) return true
  if (raw.includes('4 条必须风格不同') && raw.includes('可爱活泼、清单安利、轻松催领、简洁清新')) return true
  return false
}

export function writeAfternoonTeaNoticeSystemPrompt(
  value: string,
  storage: StorageWriter | null = typeof window === 'undefined' ? null : window.localStorage,
) {
  writeStorageItem(AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT_STORAGE_KEY, value, storage)
}
