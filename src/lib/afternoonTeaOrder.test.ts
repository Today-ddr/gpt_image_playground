import { describe, expect, it } from 'vitest'
import { parseAfternoonTeaOrderResult } from './afternoonTeaOrder'

const validResult = {
  titles: ['午后茶歇', '暖心时光'],
  items: [
    { displayName: '草莓酸奶碗', tags: ['草莓', '酸奶'] },
  ],
}

describe('parseAfternoonTeaOrderResult', () => {
  it('parses pure JSON', () => {
    expect(parseAfternoonTeaOrderResult(JSON.stringify(validResult), 2)).toEqual(validResult)
  })

  it('parses one complete json code block', () => {
    const text = `\`\`\`json
${JSON.stringify(validResult)}
\`\`\``

    expect(parseAfternoonTeaOrderResult(text, 2)).toEqual(validResult)
  })

  it('trims titles', () => {
    const text = JSON.stringify({ ...validResult, titles: [' 午后茶歇 ', '暖心时光\n'] })

    expect(parseAfternoonTeaOrderResult(text, 2).titles).toEqual(['午后茶歇', '暖心时光'])
  })

  it('rejects duplicate titles after trimming', () => {
    const text = JSON.stringify({ ...validResult, titles: ['午后茶歇', ' 午后茶歇 '] })

    expect(() => parseAfternoonTeaOrderResult(text, 2)).toThrow('下午茶订单解析结果格式无效')
  })

  it('rejects malformed JSON with a fixed message', () => {
    expect(() => parseAfternoonTeaOrderResult('{', 2)).toThrow('下午茶订单解析结果格式无效')
  })

  it.each([
    [[123, '暖心时光'], 'non-string title'],
    [['  ', '暖心时光'], 'blank title'],
  ])('rejects an invalid title: %s', (titles, _label) => {
    const text = JSON.stringify({ ...validResult, titles })

    expect(() => parseAfternoonTeaOrderResult(text, 2)).toThrow('下午茶订单解析结果格式无效')
  })

  it.each([
    [['午后茶歇'], 2],
    [['午后茶歇', '暖心时光', '轻松一刻'], 2],
  ])('requires the title count to equal the expected count', (titles, count) => {
    const text = JSON.stringify({ ...validResult, titles })

    expect(() => parseAfternoonTeaOrderResult(text, count)).toThrow('下午茶订单解析结果格式无效')
  })

  it.each([
    ['null', 'null root'],
    ['[]', 'array root'],
    [JSON.stringify({ items: validResult.items }), 'missing titles'],
    [JSON.stringify({ titles: validResult.titles }), 'missing items'],
  ])('rejects an invalid root structure: %s', (text) => {
    expect(() => parseAfternoonTeaOrderResult(text, 2)).toThrow('下午茶订单解析结果格式无效')
  })

  it('rejects empty items', () => {
    const text = JSON.stringify({ ...validResult, items: [] })

    expect(() => parseAfternoonTeaOrderResult(text, 2)).toThrow('下午茶订单解析结果格式无效')
  })

  it('rejects a scalar item', () => {
    const text = JSON.stringify({ ...validResult, items: [1] })

    expect(() => parseAfternoonTeaOrderResult(text, 2)).toThrow('下午茶订单解析结果格式无效')
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid expected title count: %s', (count) => {
    expect(() => parseAfternoonTeaOrderResult(JSON.stringify(validResult), count))
      .toThrow('下午茶订单解析结果格式无效')
  })

  it.each([
    [{ tags: ['草莓'] }, 'missing displayName'],
    [{ displayName: '', tags: ['草莓'] }, 'empty displayName'],
    [{ displayName: '   ', tags: ['草莓'] }, 'blank displayName'],
    [{ displayName: 123, tags: ['草莓'] }, 'non-string displayName'],
  ])('requires a non-empty item displayName: %s', (item, _label) => {
    const text = JSON.stringify({ ...validResult, items: [item] })

    expect(() => parseAfternoonTeaOrderResult(text, 2)).toThrow('下午茶订单解析结果格式无效')
  })

  it.each([
    [null, 'null'],
    ['草莓', 'string'],
    [['草莓', 1], 'non-string item'],
  ])('requires tags to be a string array: %s', (tags, _label) => {
    const text = JSON.stringify({ ...validResult, items: [{ displayName: '草莓酸奶碗', tags }] })

    expect(() => parseAfternoonTeaOrderResult(text, 2)).toThrow('下午茶订单解析结果格式无效')
  })

  it('trims tags, removes blanks, and deduplicates them', () => {
    const text = JSON.stringify({
      ...validResult,
      items: [{ displayName: '草莓酸奶碗', tags: [' 草莓 ', '', '  ', '酸奶', '草莓'] }],
    })

    expect(parseAfternoonTeaOrderResult(text, 2).items[0].tags).toEqual(['草莓', '酸奶'])
  })
})
