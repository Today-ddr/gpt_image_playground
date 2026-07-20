import { describe, expect, it } from 'vitest'
import {
  buildDishAnalysisSystemPrompt,
  buildDishAnalysisUserPrompt,
  DEFAULT_DISH_SYSTEM_PROMPT,
  DEFAULT_DISH_TITLE_COUNT,
  DEFAULT_DISH_USER_PROMPT,
} from './dishAnalysisPrompts'

describe('dish analysis prompts', () => {
  it('keeps editable source defaults in the project', () => {
    expect(DEFAULT_DISH_TITLE_COUNT).toBe(5)
    expect(DEFAULT_DISH_USER_PROMPT).toBe('')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('公司下午茶图片设计助手')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('生成 {{titleCount}} 个不同标题')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('必须只返回纯 JSON')
  })

  it('replaces every title count placeholder in the system prompt', () => {
    expect(buildDishAnalysisSystemPrompt('生成 {{titleCount}} 个标题，共 {{titleCount}} 个', 3))
      .toBe('生成 3 个标题，共 3 个')
  })

  it('builds a user prompt with the numeric title count and trimmed order', () => {
    expect(buildDishAnalysisUserPrompt('  奶茶 x 2\n蛋糕 x 1  ', 4))
      .toBe('标题数量：4\n\n下午茶订单：\n奶茶 x 2\n蛋糕 x 1')
  })

  it('builds the default request without leaving a title count token', () => {
    const prompt = buildDishAnalysisSystemPrompt(DEFAULT_DISH_SYSTEM_PROMPT, DEFAULT_DISH_TITLE_COUNT)

    expect(prompt).toContain('生成 5 个不同标题')
    expect(prompt).not.toContain('{{titleCount}}')
    expect(buildDishAnalysisUserPrompt(' 草莓蛋糕 x 2 ', DEFAULT_DISH_TITLE_COUNT))
      .toBe('标题数量：5\n\n下午茶订单：\n草莓蛋糕 x 2')
  })
})
