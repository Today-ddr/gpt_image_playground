import { describe, expect, it } from 'vitest'
import { DEFAULT_DISH_SYSTEM_PROMPT, DEFAULT_DISH_USER_PROMPT } from './dishAnalysisPrompts'

describe('dish analysis prompts', () => {
  it('keeps editable source defaults in the project', () => {
    expect(DEFAULT_DISH_USER_PROMPT).toBe('标题数量：5\n\n下午茶订单：')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('公司下午茶图片设计助手')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('生成 {{titleCount}} 个不同标题')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('必须只返回纯 JSON')
  })
})
