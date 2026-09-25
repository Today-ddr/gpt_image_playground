import { describe, expect, it } from 'vitest'
import {
  mergeSegmentedDishAnalysis,
  resizeAfternoonTeaTitles,
  segmentAfternoonTeaMenu,
} from './afternoonTeaMenu'
import type { AfternoonTeaOrderResult } from '../types'

const menu = `套餐A：东坡淋汁豆腐+现磨原味豆浆
套餐B：豆腐小吃拼盘
套餐C：豆乳面+现磨原味豆浆
套餐D：天贝轻食卷+腐皮糯米鸡`

describe('segmentAfternoonTeaMenu', () => {
  it('keeps each combo line as one item and does not merge the repeated drink', () => {
    expect(segmentAfternoonTeaMenu(menu)).toEqual([
      { displayName: '东坡淋汁豆腐+现磨原味豆浆' },
      { displayName: '豆腐小吃拼盘' },
      { displayName: '豆乳面+现磨原味豆浆' },
      { displayName: '天贝轻食卷+腐皮糯米鸡' },
    ])
  })

  it('strips quantity, parenthetical notes, and category-only lines', () => {
    expect(segmentAfternoonTeaMenu(`热食
套餐A：红烧豆腐 x 2（少辣）
饮品：
1、柠檬红茶（少冰）`)).toEqual([
      { displayName: '红烧豆腐' },
      { displayName: '柠檬红茶' },
    ])
  })

  it('treats one labeled combo line as a single item', () => {
    expect(segmentAfternoonTeaMenu('套餐A：豆腐+豆浆')).toEqual([
      { displayName: '豆腐+豆浆' },
    ])
  })

  it('reads a pasted notice and keeps only the combo rows', () => {
    expect(segmentAfternoonTeaMenu(`下午茶来咯🥢✨
四款豆制轻食随心挑👇
▫️套餐A：东坡淋汁豆腐+现磨原味豆浆🥛
▫️套餐B：豆腐小吃拼盘🥟
▫️套餐C：豆乳面+现磨原味豆浆🥛
▫️套餐D：天贝轻食卷+腐皮糯米鸡🌯
这波清爽又管饱，安排得明明白白🤤`)).toEqual([
      { displayName: '东坡淋汁豆腐+现磨原味豆浆' },
      { displayName: '豆腐小吃拼盘' },
      { displayName: '豆乳面+现磨原味豆浆' },
      { displayName: '天贝轻食卷+腐皮糯米鸡' },
    ])
  })

  it('keeps plain dish lines when one dashed note is mixed in', () => {
    expect(segmentAfternoonTeaMenu(`牛肉肠粉
柠檬红茶
- 加一份布丁`)).toEqual([
      { displayName: '牛肉肠粉' },
      { displayName: '柠檬红茶' },
      { displayName: '加一份布丁' },
    ])
  })

  it('leaves a single prose sentence to the model', () => {
    expect(segmentAfternoonTeaMenu('草莓蛋糕和柠檬红茶')).toBeNull()
    expect(segmentAfternoonTeaMenu('   ')).toBeNull()
  })
})

describe('resizeAfternoonTeaTitles', () => {
  const result: AfternoonTeaOrderResult = {
    titles: ['午后茶歇', '暖心时光'],
    titleCandidates: ['午后茶歇', '暖心时光', '今日小食', '本周茶点'],
    items: [{ displayName: '豆腐小吃拼盘', tags: [] }],
  }

  it('adds the next unused candidate without touching items', () => {
    const resized = resizeAfternoonTeaTitles(result, 3)

    expect(resized.titles).toEqual(['午后茶歇', '暖心时光', '今日小食'])
    expect(resized.items).toEqual(result.items)
  })

  it('drops the last title when the poster count shrinks', () => {
    expect(resizeAfternoonTeaTitles(result, 1).titles).toEqual(['午后茶歇'])
  })
})

describe('mergeSegmentedDishAnalysis', () => {
  const segments = segmentAfternoonTeaMenu(menu) ?? []
  const model: AfternoonTeaOrderResult = {
    titles: ['今日下午茶', '午后茶歇'],
    titleCandidates: ['今日下午茶', '午后茶歇', '今日小食', '本周茶点'],
    items: [
      { displayName: '东坡淋汁豆腐', tags: ['豆腐'] },
      { displayName: '现磨原味豆浆', tags: ['豆浆'] },
      { displayName: '豆腐小吃拼盘', tags: ['豆腐'] },
      { displayName: '豆乳面', tags: ['豆乳'] },
      { displayName: '现磨原味豆浆', tags: ['豆浆'] },
      { displayName: '天贝轻食卷', tags: ['天贝'] },
    ],
  }

  it('forces four local names when the model splits combos into six items', () => {
    const merged = mergeSegmentedDishAnalysis({
      segments,
      model,
      current: null,
      preliminaryItems: null,
      titleCount: 2,
      titlesCustomized: false,
    })

    expect(merged.items.map((item) => item.displayName)).toEqual(segments.map((segment) => segment.displayName))
    expect(merged.items.map((item) => item.tags)).toEqual([[], ['豆腐'], [], []])
    expect(merged.titles).toEqual(['今日下午茶', '午后茶歇'])
  })

  it('uses the model display names when the item count stays one per line', () => {
    const positionSegments = [
      { displayName: '左上牛肉肠粉' },
      { displayName: '右上猪肉蛋肠粉' },
      { displayName: '左下鲜虾蛋肠粉' },
      { displayName: '右下海鲜蛋肠粉' },
    ]
    const cleaned: AfternoonTeaOrderResult = {
      titles: ['今日下午茶', '午后茶歇'],
      items: [
        { displayName: '牛肉肠粉', tags: ['牛肉', '肠粉'] },
        { displayName: '猪肉蛋肠粉', tags: ['猪肉', '蛋'] },
        { displayName: '鲜虾蛋肠粉', tags: ['虾', '蛋'] },
        { displayName: '海鲜蛋肠粉', tags: ['海鲜'] },
      ],
    }
    const merged = mergeSegmentedDishAnalysis({
      segments: positionSegments,
      model: cleaned,
      current: {
        titles: ['今日下午茶', '午后茶歇'],
        items: positionSegments.map((segment) => ({ displayName: segment.displayName, tags: [] })),
      },
      preliminaryItems: positionSegments.map((segment) => ({ displayName: segment.displayName, tags: [] })),
      titleCount: 2,
      titlesCustomized: false,
    })

    expect(merged.items.map((item) => item.displayName)).toEqual([
      '牛肉肠粉',
      '猪肉蛋肠粉',
      '鲜虾蛋肠粉',
      '海鲜蛋肠粉',
    ])
    expect(merged.items[0].tags).toEqual(['牛肉', '肠粉'])
  })

  it('keeps a name edited while titles were still loading', () => {
    const preliminary = segments.map((segment) => ({ displayName: segment.displayName, tags: [] as string[] }))
    const current: AfternoonTeaOrderResult = {
      titles: ['今日下午茶', '午后茶歇'],
      items: preliminary.map((item, index) => index === 1 ? { ...item, displayName: '小吃拼盘' } : item),
    }
    const alignedModel: AfternoonTeaOrderResult = {
      ...model,
      items: segments.map((segment, index) => ({ displayName: segment.displayName, tags: [`贴纸${index}`] })),
    }
    const merged = mergeSegmentedDishAnalysis({
      segments,
      model: alignedModel,
      current,
      preliminaryItems: preliminary,
      titleCount: 2,
      titlesCustomized: false,
    })

    expect(merged.items[1]).toEqual({ displayName: '小吃拼盘', tags: ['贴纸1'] })
    expect(merged.items[0].tags).toEqual(['贴纸0'])
  })

  it('keeps titles the user already changed', () => {
    const current: AfternoonTeaOrderResult = {
      titles: ['我的标题', '午后茶歇'],
      items: segments.map((segment) => ({ displayName: segment.displayName, tags: [] })),
    }
    const merged = mergeSegmentedDishAnalysis({
      segments,
      model,
      current,
      preliminaryItems: current.items,
      titleCount: 2,
      titlesCustomized: true,
    })

    expect(merged.titles).toEqual(['我的标题', '午后茶歇'])
  })
})
