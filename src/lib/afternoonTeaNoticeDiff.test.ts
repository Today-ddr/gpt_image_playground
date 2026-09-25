import { describe, expect, it } from 'vitest'
import { diffAfternoonTeaNotice } from './afternoonTeaNoticeDiff'

const baseline = [
  '今天是咸香汉堡补给🍔',
  '',
  '三款汉堡随心挑👇',
  '▫️蛋黄肉+芝士肉',
  '▫️葱肉+梅干菜肉',
  '',
  '热乎乎的，吃起来刚刚好😋',
].join('\n')

describe('diffAfternoonTeaNotice', () => {
  it('marks only the opening and closing against the first card', () => {
    const current = [
      '今日下午茶·汉堡专场✨',
      '',
      '三款汉堡随心挑👇',
      '▫️蛋黄肉+芝士肉',
      '▫️葱肉+梅干菜肉',
      '',
      '咸香到位，大口满足😋',
    ].join('\n')
    const diff = diffAfternoonTeaNotice(baseline, current)

    expect(diff.parts).toEqual(['开场', '收尾'])
    expect(diff.lines.filter((line) => line.changed).map((line) => line.text)).toEqual([
      '今日下午茶·汉堡专场✨',
      '咸香到位，大口满足😋',
    ])
  })

  it('reports an identical card as having no differing parts', () => {
    expect(diffAfternoonTeaNotice(baseline, baseline).parts).toEqual([])
    expect(diffAfternoonTeaNotice(baseline, baseline).lines.some((line) => line.changed)).toBe(false)
  })

  it('marks a changed menu line as the list', () => {
    const current = baseline.replace('▫️葱肉+梅干菜肉', '▫️榨菜肉')
    const diff = diffAfternoonTeaNotice(baseline, current)

    expect(diff.parts).toEqual(['清单'])
    expect(diff.lines.find((line) => line.text === '▫️榨菜肉')?.changed).toBe(true)
    expect(diff.lines.find((line) => line.text === '今天是咸香汉堡补给🍔')?.changed).toBe(false)
  })
})