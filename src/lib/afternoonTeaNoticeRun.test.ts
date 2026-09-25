import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { AFTERNOON_TEA_NOTICE_STYLE_LABELS } from './afternoonTeaNoticePrompts'
import { AfternoonTeaNoticeRunCoordinator, runAfternoonTeaNotice } from './afternoonTeaNoticeRun'

const profile = createDefaultOpenAIProfile({
  name: '测试渠道',
  understandingModel: 'gpt-4.1-mini',
})

function noticePayload() {
  return JSON.stringify({
    itemsIntro: '两款随心挑👇',
    itemLines: ['豆腐+豆浆🥛', '豆腐小吃拼盘🥟'],
    tip: '',
    notices: AFTERNOON_TEA_NOTICE_STYLE_LABELS.map((style) => ({
      style,
      opening: `${style}的开场🍔`,
      closing: `${style}的收尾😋`,
    })),
  })
}

describe('AfternoonTeaNoticeRunCoordinator', () => {
  it('replaces the previous request for the same conversation and leaves the new one running', () => {
    const coordinator = new AfternoonTeaNoticeRunCoordinator()
    const first = coordinator.begin('conversation-a')
    const other = coordinator.begin('conversation-b')
    const second = coordinator.begin('conversation-a')

    expect(first.signal.aborted).toBe(true)
    expect(other.signal.aborted).toBe(false)
    expect(second.signal.aborted).toBe(false)
    expect(coordinator.isCurrent('conversation-a', first)).toBe(false)
    expect(coordinator.isCurrent('conversation-a', second)).toBe(true)
    expect(coordinator.isCurrent('conversation-b', other)).toBe(true)

    coordinator.finish('conversation-a', first)
    expect(coordinator.isCurrent('conversation-a', second)).toBe(true)
    coordinator.finish('conversation-a', second)
    expect(coordinator.isCurrent('conversation-a', second)).toBe(false)
  })
})

describe('runAfternoonTeaNotice', () => {
  it('locks menu rows and sends the supplement without waiting on another task', async () => {
    let seenPrompt = ''
    const result = await runAfternoonTeaNotice({
      menuText: '套餐A：豆腐+豆浆\n套餐B：豆腐小吃拼盘',
      supplement: '汉堡包',
      systemPrompt: '系统提示词',
      profile,
      generate: async (options) => {
        seenPrompt = options.userPrompt
        return noticePayload()
      },
    })

    expect(seenPrompt).toContain('补充信息：汉堡包')
    expect(seenPrompt).toContain('1. 豆腐+豆浆')
    expect(seenPrompt).toContain('不要写成肉饼或肉饼拼盘')
    expect(result.sourceChannel).toBe('测试渠道')
    expect(result.sourceModel).toBe('gpt-4.1-mini')
    expect(result.notices).toHaveLength(4)
    expect(result.notices[0].text).toContain('▫️豆腐+豆浆🥛')
    expect(result.elapsed).toBeGreaterThanOrEqual(0)
  })

  it('lets a failed notice reject on its own', async () => {
    await expect(runAfternoonTeaNotice({
      menuText: '套餐A：豆腐+豆浆',
      supplement: '',
      systemPrompt: '系统提示词',
      profile,
      generate: async () => {
        throw new Error('通知接口失败')
      },
    })).rejects.toThrow('通知接口失败')
  })
})
