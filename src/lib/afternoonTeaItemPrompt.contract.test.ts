import { describe, expect, it } from 'vitest'
import type { AfternoonTeaOrderResult } from '../types'
import { buildAfternoonTeaPosterPrompts } from './afternoonTeaPosterPromptBuilder'
import { getAfternoonTeaTitlePlacement } from './afternoonTeaTitlePlacement'

const result: AfternoonTeaOrderResult = {
  titles: ['今日下午茶', '午后茶歇'],
  items: [
    { displayName: '蟹肉沙拉紫菜包饭', tags: ['蟹肉', '沙拉', '紫菜', '米饭'] },
    { displayName: '金枪鱼紫菜包饭', tags: ['金枪鱼', '紫菜', '米饭'] },
  ],
}

const regions = [
  { x: 0.05, y: 0.08, width: 0.38, height: 0.14 },
  { x: 0.52, y: 0.62, width: 0.38, height: 0.14 },
]

function readPosterData(prompt: string) {
  const marker = '【posterData】\n'
  return JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as {
    title: string
    items: Array<{ displayName: string; tags: string[]; placement: ReturnType<typeof getAfternoonTeaTitlePlacement> }>
  }
}

describe('afternoon tea item title prompt contract', () => {
  it('writes an independent semantic placement for every product in every candidate prompt', () => {
    const prompts = buildAfternoonTeaPosterPrompts(result, regions)
    const expected = regions.map(getAfternoonTeaTitlePlacement)

    expect(prompts).toHaveLength(result.titles.length)
    for (const prompt of prompts) {
      expect(readPosterData(prompt.prompt).items.map((item) => item.placement)).toEqual(expected)
    }
  })

  it('treats edited display names as visible product labels and keeps the poster title separate', () => {
    const edited = { ...result, items: [{ ...result.items[0], displayName: '蟹肉紫菜包饭' }, result.items[1]] }
    const [prompt] = buildAfternoonTeaPosterPrompts(edited, regions)
    const data = readPosterData(prompt.prompt)

    expect(data.items[0].displayName).toBe('蟹肉紫菜包饭')
    expect(data.title).toBe('今日下午茶')
    expect(prompt.prompt).toContain('每个 posterData.items 条目的 displayName 必须且只能显示一次')
    expect(prompt.prompt).toContain('不得把一个商品名放到另一个商品的区域')
    expect(prompt.prompt).toContain('不得显示坐标、百分比、边框、定位框或辅助标记')
    expect(prompt.prompt).toContain('不得在其他位置重复商品名称')
    expect(prompt.prompt).toContain('所有区域都需要识别，但只能为 posterData.items 中的条目添加商品文字标签')
    expect(prompt.prompt).toContain('如果 tags 与 displayName 冲突，以 displayName 为准，忽略冲突的 tags')
    expect(prompt.prompt).not.toContain('每一个下午茶区域都必须被识别和标注')
    expect(prompt.prompt).not.toContain('允许跳过无法可靠匹配的区域或条目')
    expect(prompt.prompt).not.toContain('可以在各区域重复同一 displayName')
    expect(prompt.prompt).not.toContain('posterData.titlePlacement')
  })
})
