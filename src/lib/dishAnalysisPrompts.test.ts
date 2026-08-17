import { describe, expect, it } from 'vitest'
import {
  buildDishAnalysisSystemPrompt,
  buildDishAnalysisUserPrompt,
  DEFAULT_DISH_SYSTEM_PROMPT,
  DEFAULT_DISH_TITLE_COUNT,
  DEFAULT_DISH_USER_PROMPT,
  getDishAnalysisCandidateCount,
  resolveAfternoonTeaTitleCandidates,
} from './dishAnalysisPrompts'

describe('dish analysis prompts', () => {
  it('keeps editable source defaults in the project', () => {
    expect(DEFAULT_DISH_TITLE_COUNT).toBe(4)
    expect(DEFAULT_DISH_USER_PROMPT).toBe('')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('公司下午茶图片设计助手')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('整理出用于生成下午茶分享图片的标题和商品贴纸信息')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('【displayName 商品名称】')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('【tags 贴纸关键词】')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('生成 {{candidateCount}} 个互不重复、适合放在下午茶分享图片顶部的大标题')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('titleCandidates')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('同一批里必须错开说法')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('标题不要包含')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('公司')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('员工')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('福利')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('活动')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('通知')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('必须只返回纯 JSON')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).not.toContain('生成 {{titleCount}} 个不同标题')
  })

  it('replaces every title count placeholder in the system prompt', () => {
    expect(buildDishAnalysisSystemPrompt('生成 {{titleCount}} 个标题，共 {{titleCount}} 个', 3))
      .toBe('生成 3 个标题，共 3 个')
  })

  it('scales candidate count to at least eight and titleCount plus six', () => {
    expect(getDishAnalysisCandidateCount(2)).toBe(8)
    expect(getDishAnalysisCandidateCount(4)).toBe(10)
    expect(getDishAnalysisCandidateCount(10)).toBe(16)
  })

  it('replaces candidate count placeholders before title count tokens', () => {
    expect(buildDishAnalysisSystemPrompt('备选 {{candidateCount}}，选用 {{titleCount}}', 4))
      .toBe('备选 10，选用 4')
  })

  it('builds a user prompt with the numeric title count and trimmed order', () => {
    expect(buildDishAnalysisUserPrompt('  奶茶 x 2\n蛋糕 x 1  ', 4))
      .toBe('标题数量：4\n备选标题数量：10\n\n下午茶订单：\n奶茶 x 2\n蛋糕 x 1')
  })

  it('builds the default request without leaving a title count token', () => {
    const prompt = buildDishAnalysisSystemPrompt(DEFAULT_DISH_SYSTEM_PROMPT, DEFAULT_DISH_TITLE_COUNT)

    expect(prompt).toContain('生成 10 个互不重复、适合放在下午茶分享图片顶部的大标题')
    expect(prompt).toContain('titles 填写最推荐的前 4 个')
    expect(prompt).not.toContain('{{titleCount}}')
    expect(prompt).not.toContain('{{candidateCount}}')
    expect(buildDishAnalysisUserPrompt(' 草莓蛋糕 x 2 ', DEFAULT_DISH_TITLE_COUNT))
      .toBe('标题数量：4\n备选标题数量：10\n\n下午茶订单：\n草莓蛋糕 x 2')
  })

  it('fills missing title candidates with the built-in afternoon tea pool', () => {
    expect(resolveAfternoonTeaTitleCandidates({
      titles: ['今日下午茶', '午后茶歇'],
    })).toEqual([
      '今日下午茶',
      '午后茶歇',
      '下午茶时光',
      '下午茶分享',
      '今日茶歇',
      '今日小食',
      '午后小食',
      '本周甜品',
    ])
  })

  it('keeps model candidates ahead of the built-in fallbacks', () => {
    expect(resolveAfternoonTeaTitleCandidates({
      titles: ['今日下午茶', '午后茶歇'],
      titleCandidates: ['今日下午茶', '午后茶歇', '本周小食'],
    })).toContain('本周小食')
  })
})
