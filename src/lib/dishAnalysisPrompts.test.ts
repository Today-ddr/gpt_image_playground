import { describe, expect, it } from 'vitest'
import { DEFAULT_DISH_SYSTEM_PROMPT, DEFAULT_DISH_USER_PROMPT } from './dishAnalysisPrompts'

describe('dish analysis prompts', () => {
  it('keeps editable source defaults in the project', () => {
    expect(DEFAULT_DISH_USER_PROMPT).toBe('请解析这张餐品图片')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('餐品分析助手')
    expect(DEFAULT_DISH_SYSTEM_PROMPT).toContain('不要把猜测写成事实')
  })
})
