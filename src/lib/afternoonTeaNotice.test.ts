import { describe, expect, it } from 'vitest'
import {
  AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE,
  applyAfternoonTeaNoticeText,
  buildAfternoonTeaNoticeUserPrompt,
  createEmptyAfternoonTeaNoticeDraft,
  getAfternoonTeaNoticePrimaryActionLabel,
  parseAfternoonTeaNoticeResult,
  parseAfternoonTeaNoticeResultForStyles,
  pickAfternoonTeaNoticeStyles,
  readAfternoonTeaNoticeDraft,
  readAfternoonTeaNoticeSystemPrompt,
  resolveAfternoonTeaNoticeSelectedIndex,
  validateAfternoonTeaNoticeInput,
  writeAfternoonTeaNoticeDraft,
  writeAfternoonTeaNoticeSystemPrompt,
} from './afternoonTeaNotice'
import {
  AFTERNOON_TEA_NOTICE_DRAFT_STORAGE_KEY,
  AFTERNOON_TEA_NOTICE_RESULT_COUNT,
  AFTERNOON_TEA_NOTICE_EMOJI_COUNT,
  AFTERNOON_TEA_NOTICE_EMOJI_STYLE_LABELS,
  AFTERNOON_TEA_NOTICE_PLAIN_COUNT,
  AFTERNOON_TEA_NOTICE_PLAIN_STYLE_LABELS,
  AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT_STORAGE_KEY,
  DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT,
} from './afternoonTeaNoticePrompts'

const validNotices = {
  notices: [
    { style: '可爱活泼', text: '🍰下午茶来咯～' },
    { style: '清单安利', text: '今日有巴斯克和果汁' },
    { style: '轻松催领', text: '工作间隙来领一份' },
    { style: '简洁清新', text: '下午茶已备好，请来领取。' },
  ] as const,
}

function createMemoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (key: string) => Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    data,
  }
}

describe('parseAfternoonTeaNoticeResult', () => {
  it('parses pure JSON and keeps the source style order', () => {
    const shuffled = {
      notices: [
        validNotices.notices[2],
        validNotices.notices[0],
        validNotices.notices[3],
        validNotices.notices[1],
      ],
    }

    expect(parseAfternoonTeaNoticeResult(JSON.stringify(shuffled))).toEqual(shuffled.notices)
  })

  it('reorders notices to match the requested styles', () => {
    const requested = ['清单安利', '美味安排', '可爱活泼'] as const
    const payload = {
      notices: [
        { style: '美味安排', text: '今日美味安排✨巴斯克蛋糕' },
        { style: '可爱活泼', text: '🍰下午茶来咯～' },
        { style: '清单安利', text: '今日有巴斯克和果汁' },
      ],
    }

    expect(parseAfternoonTeaNoticeResultForStyles(JSON.stringify(payload), requested)).toEqual([
      { style: '清单安利', text: '今日有巴斯克和果汁' },
      { style: '美味安排', text: '今日美味安排✨巴斯克蛋糕' },
      { style: '可爱活泼', text: '🍰下午茶来咯～' },
    ])
  })

  it('parses one complete json code block', () => {
    const text = `\`\`\`json
${JSON.stringify(validNotices)}
\`\`\``

    expect(parseAfternoonTeaNoticeResult(text)).toEqual(validNotices.notices)
  })

  it('parses a json code block surrounded by extra text', () => {
    const text = `好的，这是结果：
\`\`\`json
${JSON.stringify(validNotices)}
\`\`\`
祝用餐愉快`

    expect(parseAfternoonTeaNoticeResult(text)).toEqual(validNotices.notices)
  })

  it('trims style and text', () => {
    const text = JSON.stringify({
      notices: validNotices.notices.map((notice) => ({
        style: ` ${notice.style} `,
        text: `\n${notice.text}\n`,
      })),
    })

    expect(parseAfternoonTeaNoticeResult(text)).toEqual(validNotices.notices)
  })

  it('rejects malformed JSON with a fixed message', () => {
    expect(() => parseAfternoonTeaNoticeResult('{')).toThrow(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  })

  it.each([
    [{}, 'missing notices'],
    [{ notices: [] }, 'empty notices'],
    [{ notices: [...validNotices.notices, { style: '可爱活泼', text: '重复' }] }, 'duplicate style'],
    [{ notices: validNotices.notices.map((notice, index) => index === 0 ? { style: '公文腔', text: notice.text } : notice) }, 'unknown style'],
    [{ notices: validNotices.notices.map((notice, index) => index === 1 ? { style: notice.style, text: '  ' } : notice) }, 'blank text'],
    [{ notices: validNotices.notices.map((notice, index) => index === 2 ? { style: notice.style } : notice) }, 'missing text'],
  ])('rejects invalid payload %#', (payload, _label) => {
    expect(() => parseAfternoonTeaNoticeResult(JSON.stringify(payload))).toThrow(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  })

  it('rejects a result that does not match the requested styles', () => {
    const requested = ['可爱活泼', '清单安利', '轻松催领'] as const
    expect(() => parseAfternoonTeaNoticeResultForStyles(JSON.stringify(validNotices), requested)).toThrow(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
    expect(() => parseAfternoonTeaNoticeResultForStyles(JSON.stringify({
      notices: validNotices.notices.slice(0, 2),
    }), requested)).toThrow(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  })
})

describe('afternoon tea notice helpers', () => {
  it('requires a menu and keeps brand optional in the user prompt', () => {
    expect(() => validateAfternoonTeaNoticeInput('  ')).toThrow('请填写今日菜单')
    const menuOnlyPrompt = buildAfternoonTeaNoticeUserPrompt(' 原味巴斯克\n开心果巴斯克 ', '')
    expect(menuOnlyPrompt).toContain('今日菜单：\n原味巴斯克\n开心果巴斯克')
    expect(menuOnlyPrompt).toContain('品牌：（未提供，不要编造品牌）')
    const prompt = buildAfternoonTeaNoticeUserPrompt('原味巴斯克', ' 捏捏虎 ', ['轻松催领', '日常告知'])
    expect(prompt).toContain('品牌：捏捏虎')
    expect(prompt).toContain('本次必须恰好写出 2 条通知')
    expect(prompt).toContain('1. 轻松催领')
    expect(prompt).toContain('2. 日常告知')
    expect(prompt).toContain('必须使用 emoji')
    expect(prompt).toContain('禁止使用 emoji')
    expect(prompt).toContain('6 条必须一眼能看出不同')
    expect(prompt).toContain('参考例只是口吻，不是填空模板')
    expect(prompt).not.toContain('可爱活泼')
  })

  it('picks 5 emoji styles and 1 plain style, preferring unused ones', () => {
    const previous = [
      ...AFTERNOON_TEA_NOTICE_EMOJI_STYLE_LABELS.slice(0, AFTERNOON_TEA_NOTICE_EMOJI_COUNT),
      AFTERNOON_TEA_NOTICE_PLAIN_STYLE_LABELS[0],
    ]
    const picked = pickAfternoonTeaNoticeStyles(previous, { random: () => 0 })
    const pickedEmoji = picked.filter((label) => AFTERNOON_TEA_NOTICE_EMOJI_STYLE_LABELS.includes(label))
    const pickedPlain = picked.filter((label) => AFTERNOON_TEA_NOTICE_PLAIN_STYLE_LABELS.includes(label))
    const unusedEmoji = AFTERNOON_TEA_NOTICE_EMOJI_STYLE_LABELS.filter((label) => !previous.includes(label))
    const unusedPlain = AFTERNOON_TEA_NOTICE_PLAIN_STYLE_LABELS.filter((label) => !previous.includes(label))

    expect(picked).toHaveLength(AFTERNOON_TEA_NOTICE_RESULT_COUNT)
    expect(new Set(picked).size).toBe(AFTERNOON_TEA_NOTICE_RESULT_COUNT)
    expect(pickedEmoji).toHaveLength(AFTERNOON_TEA_NOTICE_EMOJI_COUNT)
    expect(pickedPlain).toHaveLength(AFTERNOON_TEA_NOTICE_PLAIN_COUNT)
    expect(unusedEmoji.every((label) => pickedEmoji.includes(label))).toBe(true)
    expect(unusedPlain.includes(pickedPlain[0])).toBe(true)
  })

  it('updates selected notice text and clamps the selected index', () => {
    const notices = validNotices.notices
    expect(applyAfternoonTeaNoticeText(notices, 1, '今日有巴斯克和果汁')).toBe(notices)
    expect(applyAfternoonTeaNoticeText(notices, 1, '改过的清单')[1]).toEqual({
      style: '清单安利',
      text: '改过的清单',
    })
    expect(applyAfternoonTeaNoticeText(notices, -1, '忽略')).toBe(notices)
    expect(resolveAfternoonTeaNoticeSelectedIndex(notices, 3)).toBe(3)
    expect(resolveAfternoonTeaNoticeSelectedIndex(notices, 9)).toBe(0)
    expect(resolveAfternoonTeaNoticeSelectedIndex([], 2)).toBe(0)
  })

  it('picks the primary action label from status and existing results', () => {
    expect(getAfternoonTeaNoticePrimaryActionLabel('idle', 0)).toBe('生成通知')
    expect(getAfternoonTeaNoticePrimaryActionLabel('success', 4)).toBe('再生成')
    expect(getAfternoonTeaNoticePrimaryActionLabel('running', 4)).toBe('取消')
  })

  it('reads and writes the local draft, dropping invalid saved notices', () => {
    const storage = createMemoryStorage()
    expect(readAfternoonTeaNoticeDraft(storage)).toEqual(createEmptyAfternoonTeaNoticeDraft())

    writeAfternoonTeaNoticeDraft({
      menuText: '原味巴斯克',
      brand: '捏捏虎',
      notices: validNotices.notices,
      selectedIndex: 2,
    }, storage)

    expect(readAfternoonTeaNoticeDraft(storage)).toEqual({
      menuText: '原味巴斯克',
      brand: '捏捏虎',
      notices: validNotices.notices,
      selectedIndex: 2,
    })

    storage.setItem(AFTERNOON_TEA_NOTICE_DRAFT_STORAGE_KEY, JSON.stringify({
      menuText: '菜单还在',
      brand: '麦当劳',
      notices: [{ style: '公文腔', text: '不完整' }],
      selectedIndex: 4,
    }))

    expect(readAfternoonTeaNoticeDraft(storage)).toEqual({
      menuText: '菜单还在',
      brand: '麦当劳',
      notices: [],
      selectedIndex: 0,
    })
  })

  it('falls back to the default system prompt when nothing is saved', () => {
    const storage = createMemoryStorage()
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT)
    writeAfternoonTeaNoticeSystemPrompt('自定义提示词', storage)
    expect(storage.data[AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT_STORAGE_KEY]).toBe('自定义提示词')
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe('自定义提示词')

    writeAfternoonTeaNoticeSystemPrompt('旧版提示词：4 条必须风格不同，且 style 字段必须分别是：可爱活泼、清单安利、轻松催领、简洁清新。', storage)
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT)

    writeAfternoonTeaNoticeSystemPrompt('你是公司下午茶群通知文案助手。\n【风格库】\n- 可爱活泼\n只输出 JSON', storage)
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT)

    writeAfternoonTeaNoticeSystemPrompt('你是公司行政人员，要在员工微信群发今日下午茶通知。不要写成营销号、文案策划或小红书种草。', storage)
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT)

    writeAfternoonTeaNoticeSystemPrompt('【目标骨架】所有风格都必须按这个结构写\n今日美味安排✨巴斯克蛋糕 搭配 喜茶', storage)
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT)
  })

  it('treats the sample copy as tone reference, not a locked skeleton', () => {
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('你是公司行政人员')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('【口吻参考】')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('不是填空模板')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('6 条必须一眼能看出不同')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('今日美味安排✨巴斯克蛋糕 搭配 喜茶')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('【多味巴斯克】：原味 / 开心果 / 抹茶 / 奥利奥')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('满血复活')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('大家快来挑选领取享用')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('饿了就来拿一份吧')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).not.toContain('【目标骨架】')
  })
})
