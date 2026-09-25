import { describe, expect, it } from 'vitest'
import { segmentAfternoonTeaMenu } from './afternoonTeaMenu'
import {
  AFTERNOON_TEA_NOTICE_INCOMPLETE_MENU_MESSAGE,
  AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE,
  applyAfternoonTeaNoticeText,
  buildAfternoonTeaNoticeUserPrompt,
  createEmptyAfternoonTeaNoticeDraft,
  getAfternoonTeaNoticePrimaryActionLabel,
  parseAfternoonTeaNoticeResult,
  readAfternoonTeaNoticeDraft,
  readAfternoonTeaNoticeSystemPrompt,
  resolveAfternoonTeaNoticeSelectedIndex,
  validateAfternoonTeaNoticeInput,
  writeAfternoonTeaNoticeDraft,
  writeAfternoonTeaNoticeSystemPrompt,
  type AfternoonTeaNoticeMenuSegment,
} from './afternoonTeaNotice'
import {
  AFTERNOON_TEA_NOTICE_DRAFT_STORAGE_KEY,
  AFTERNOON_TEA_NOTICE_STYLE_LABELS,
  AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT_STORAGE_KEY,
  DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT,
} from './afternoonTeaNoticePrompts'

const tofuMenu = `套餐A：东坡淋汁豆腐+现磨原味豆浆
套餐B：豆腐小吃拼盘
套餐C：豆乳面+现磨原味豆浆
套餐D：天贝轻食卷+腐皮糯米鸡`

const tofuSegments = segmentAfternoonTeaMenu(tofuMenu) ?? []

const positionMenu = `左上蛋黄肉+芝士肉+虾仁肉+牛肉小饼
右上葱肉+梅干菜肉+榨菜肉
下蛋黄肉+牛肉+蟹味棒肉`

function noticeCards(openingFor?: (style: string) => string) {
  return AFTERNOON_TEA_NOTICE_STYLE_LABELS.map((style) => ({
    style,
    opening: openingFor?.(style) ?? `${style}的开场`,
    closing: `${style}的收尾`,
  }))
}

function menuCardPayload(overrides: Record<string, unknown> = {}) {
  return {
    itemsIntro: '四款豆腐套餐随心挑👇',
    itemLines: [
      '套餐A：东坡淋汁豆腐+现磨原味豆浆',
      '套餐B：豆腐小吃拼盘',
      '套餐C：豆乳面+现磨原味豆浆',
      '套餐D：天贝轻食卷+腐皮糯米鸡',
    ],
    tip: '',
    notices: noticeCards(),
    ...overrides,
  }
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
  it('assembles four cards that share one menu list', () => {
    const notices = parseAfternoonTeaNoticeResult(JSON.stringify(menuCardPayload({
      tip: '豆浆可冰可热',
      notices: noticeCards((style) => style === '活泼来咯' ? '🍰下午茶来咯～\n今日豆腐到了' : `${style}的开场`),
    })), tofuSegments)

    expect(notices.map((notice) => notice.style)).toEqual([...AFTERNOON_TEA_NOTICE_STYLE_LABELS])
    const middles = notices.map((notice) => notice.text.split('\n\n')[1])
    expect(new Set(middles).size).toBe(1)
    expect(middles[0]).toBe([
      '四款豆腐套餐随心挑👇',
      '▫️套餐A：东坡淋汁豆腐+现磨原味豆浆',
      '▫️套餐B：豆腐小吃拼盘',
      '▫️套餐C：豆乳面+现磨原味豆浆',
      '▫️套餐D：天贝轻食卷+腐皮糯米鸡',
    ].join('\n'))
    expect(notices[0].text).toContain('补给开场的开场')
    expect(notices[0].text).toContain('豆浆可冰可热')
    expect(notices[0].text.endsWith('补给开场的收尾')).toBe(true)
    expect(notices[2].text.startsWith('🍰下午茶来咯～\n今日豆腐到了')).toBe(true)
  })

  it('accepts a position menu once the location words are gone and plus signs stay', () => {
    const segments = segmentAfternoonTeaMenu(positionMenu) ?? []
    const notices = parseAfternoonTeaNoticeResult(JSON.stringify(menuCardPayload({
      itemsIntro: '三款馅料随心挑👇',
      itemLines: [
        '蛋黄肉+芝士肉+虾仁肉+牛肉小饼',
        '葱肉+梅干菜肉+榨菜肉',
        '蛋黄肉 + 牛肉 + 蟹味棒肉',
      ],
    })), segments)

    expect(notices[0].text).toContain('▫️蛋黄肉+芝士肉+虾仁肉+牛肉小饼')
    expect(notices[0].text).not.toContain('左上')
  })

  it('accepts flavor rows that keep every flavor word and the shared product word', () => {
    const segments: AfternoonTeaNoticeMenuSegment[] = [
      { displayName: '原味巴斯克' },
      { displayName: '开心果巴斯克' },
      { displayName: '抹茶巴斯克' },
      { displayName: '奥利奥巴斯克' },
      { displayName: '羽衣甘蓝双柚' },
      { displayName: '羽衣甘蓝苹果橙' },
    ]
    const notices = parseAfternoonTeaNoticeResult(JSON.stringify(menuCardPayload({
      itemsIntro: '两款随心挑👇',
      itemLines: [
        '巴斯克：原味 / 开心果 / 抹茶 / 奥利奥',
        '羽衣甘蓝：双柚 / 苹果橙',
      ],
    })), segments)

    expect(notices).toHaveLength(4)
    expect(notices[0].text).toContain('▫️巴斯克：原味 / 开心果 / 抹茶 / 奥利奥')
  })

  it('rejects a combo that was split apart', () => {
    expect(() => parseAfternoonTeaNoticeResult(JSON.stringify(menuCardPayload({
      itemsIntro: '五款随心挑👇',
      itemLines: [
        '套餐A：东坡淋汁豆腐',
        '现磨原味豆浆',
        '套餐B：豆腐小吃拼盘',
        '套餐C：豆乳面+现磨原味豆浆',
        '套餐D：天贝轻食卷+腐皮糯米鸡',
      ],
    })), tofuSegments)).toThrow(AFTERNOON_TEA_NOTICE_INCOMPLETE_MENU_MESSAGE)
  })

  it('rejects a list that drops a locked item', () => {
    expect(() => parseAfternoonTeaNoticeResult(JSON.stringify(menuCardPayload({
      itemsIntro: '三款豆腐套餐随心挑👇',
      itemLines: [
        '套餐A：东坡淋汁豆腐+现磨原味豆浆',
        '套餐B：豆腐小吃拼盘',
        '套餐D：天贝轻食卷+腐皮糯米鸡',
      ],
    })), tofuSegments)).toThrow(AFTERNOON_TEA_NOTICE_INCOMPLETE_MENU_MESSAGE)
  })

  it('does not lock item names for a single prose line', () => {
    const notices = parseAfternoonTeaNoticeResult(JSON.stringify(menuCardPayload({
      itemsIntro: '两款随心挑👇',
      itemLines: ['草莓蛋糕', '柠檬红茶'],
    })), null)

    expect(notices[0].text).toContain('▫️草莓蛋糕')
    expect(notices[0].text).toContain('▫️柠檬红茶')
  })

  it('parses one complete json code block and reorders styles', () => {
    const payload = menuCardPayload({
      notices: [...noticeCards()].reverse(),
    })
    const text = `好的，这是结果：
\`\`\`json
${JSON.stringify(payload)}
\`\`\`
祝用餐愉快`

    expect(parseAfternoonTeaNoticeResult(text, tofuSegments).map((notice) => notice.style)).toEqual([
      ...AFTERNOON_TEA_NOTICE_STYLE_LABELS,
    ])
  })

  it('rejects malformed JSON with a fixed message', () => {
    expect(() => parseAfternoonTeaNoticeResult('{')).toThrow(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  })

  it.each([
    [{}, 'missing fields'],
    [menuCardPayload({ itemsIntro: '豆腐套餐随心挑' }), 'count missing'],
    [menuCardPayload({ itemsIntro: '三款豆腐套餐随心挑👇' }), 'count mismatch'],
    [menuCardPayload({ itemLines: [] }), 'empty lines'],
    [menuCardPayload({ notices: noticeCards().slice(0, 3) }), 'missing style'],
    [menuCardPayload({ notices: [...noticeCards(), noticeCards()[0]] }), 'duplicate style'],
    [menuCardPayload({
      notices: noticeCards().map((notice, index) => index === 0 ? { ...notice, style: '公文腔' } : notice),
    }), 'unknown style'],
    [menuCardPayload({
      notices: noticeCards().map((notice, index) => index === 0 ? { ...notice, opening: '一行\n两行\n三行' } : notice),
    }), 'opening too long'],
    [menuCardPayload({
      notices: noticeCards().map((notice, index) => index === 1 ? { style: notice.style, opening: notice.opening } : notice),
    }), 'missing closing'],
  ])('rejects invalid payload %#', (payload) => {
    expect(() => parseAfternoonTeaNoticeResult(JSON.stringify(payload), tofuSegments)).toThrow(AFTERNOON_TEA_NOTICE_INVALID_RESULT_MESSAGE)
  })
})

describe('afternoon tea notice helpers', () => {
  it('requires a menu and sends locked items with the original text', () => {
    expect(() => validateAfternoonTeaNoticeInput('  ')).toThrow('请填写今日菜单')

    const prompt = buildAfternoonTeaNoticeUserPrompt(` ${tofuMenu} `, ' 捏捏虎 ', tofuSegments)
    expect(prompt).toContain(`今日菜单：\n${tofuMenu}`)
    expect(prompt).toContain('补充信息：捏捏虎')
    expect(prompt).toContain('填了汉堡包就写汉堡，不要写成肉饼或肉饼拼盘')
    expect(prompt).toContain('1. 东坡淋汁豆腐+现磨原味豆浆')
    expect(prompt).toContain('4. 天贝轻食卷+腐皮糯米鸡')
    expect(prompt).toContain('只去掉行首位置词')
    expect(prompt).toContain('套餐字母是否保留由你判断')
    expect(prompt).toContain('1. 补给开场')
    expect(prompt).toContain('4. 直球清单')
    expect(prompt).toContain('每一条菜、收尾都带贴合食物的 emoji')
    const plainPrompt = buildAfternoonTeaNoticeUserPrompt('草莓蛋糕和柠檬红茶', '', null)
    expect(plainPrompt).toContain('补充信息：（未提供。不要编造品牌或品类，按菜名本身写。）')
    expect(plainPrompt).toContain('这段菜单没有分行')
    expect(plainPrompt).not.toContain('锁定条目')
  })

  it('updates selected notice text and clamps the selected index', () => {
    const notices = parseAfternoonTeaNoticeResult(JSON.stringify(menuCardPayload()), tofuSegments)
    expect(applyAfternoonTeaNoticeText(notices, 1, notices[1].text)).toBe(notices)
    expect(applyAfternoonTeaNoticeText(notices, 1, '改过的清单')[1]).toEqual({
      style: '专场菜单',
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

  it('keeps previously saved cards, including older style names', () => {
    const storage = createMemoryStorage()
    expect(readAfternoonTeaNoticeDraft(storage)).toEqual(createEmptyAfternoonTeaNoticeDraft())

    writeAfternoonTeaNoticeDraft({
      menuText: '原味巴斯克',
      brand: '捏捏虎',
      notices: [{ style: '可爱活泼', text: '🍰下午茶来咯～' }],
      selectedIndex: 0,
      sourceChannel: ' 测试渠道 ',
      sourceModel: ' gpt-4.1-mini ',
    }, storage)

    expect(readAfternoonTeaNoticeDraft(storage)).toEqual({
      menuText: '原味巴斯克',
      brand: '捏捏虎',
      notices: [{ style: '可爱活泼', text: '🍰下午茶来咯～' }],
      selectedIndex: 0,
      sourceChannel: '测试渠道',
      sourceModel: 'gpt-4.1-mini',
    })

    storage.setItem(AFTERNOON_TEA_NOTICE_DRAFT_STORAGE_KEY, JSON.stringify({
      menuText: '菜单还在',
      brand: '麦当劳',
      notices: [
        { style: '可爱活泼', text: '旧通知还在' },
        { style: '', text: '空风格丢掉' },
        { style: '公文腔', text: '   ' },
      ],
      selectedIndex: 4,
    }))

    expect(readAfternoonTeaNoticeDraft(storage)).toEqual({
      menuText: '菜单还在',
      brand: '麦当劳',
      notices: [{ style: '可爱活泼', text: '旧通知还在' }],
      selectedIndex: 0,
      sourceChannel: '',
      sourceModel: '',
    })
  })

  it('replaces saved copies of the old default prompt and keeps a custom one', () => {
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

    writeAfternoonTeaNoticeSystemPrompt('【口吻参考】下面只是完成度\n6 条必须一眼能看出不同', storage)
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT)

    writeAfternoonTeaNoticeSystemPrompt('【菜单卡】\n可以用 emoji。不要每行都堆 emoji。', storage)
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT)

    writeAfternoonTeaNoticeSystemPrompt('【表情密度】emoji。\n没填品牌就不要编造品牌。填了就自然写进开场。', storage)
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT)

    writeAfternoonTeaNoticeSystemPrompt(`${DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT}\n补充一句`, storage)
    expect(readAfternoonTeaNoticeSystemPrompt(storage)).toBe(`${DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT}\n补充一句`)
  })

  it('describes the shared menu card instead of six unrelated styles', () => {
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('【菜单卡】')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('四张卡共用同一份清单')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('菜单里没有的不要补')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('套餐A、套餐B')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('上海小笼')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('活泼来咯')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('下午茶来咯')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('【表情密度】')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('每一条 itemLine 的菜名后面配 1 个')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('现磨原味豆浆🥛')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('【补充信息】')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('霸王茶姬')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).toContain('不要写成肉饼、肉饼拼盘或烧麦')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).not.toContain('6 条必须一眼能看出不同')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).not.toContain('不要每行都堆 emoji')
    expect(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT).not.toContain('没填品牌就不要编造品牌')
  })
})
