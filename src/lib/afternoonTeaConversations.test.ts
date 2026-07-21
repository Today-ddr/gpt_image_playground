import { describe, expect, it } from 'vitest'

import type { AfternoonTeaConversation, TaskRecord } from '../types'
import {
  canReuseRecentEmptyAfternoonTeaConversation,
  collectAfternoonTeaConversationSourceImageIds,
  getAfternoonTeaConversationBatchElapsed,
  getAfternoonTeaConversationSearchText,
  isEmptyAfternoonTeaConversation,
  normalizeAfternoonTeaTitleCount,
  normalizeAfternoonTeaConversations,
} from './afternoonTeaConversations'

function conversation(patch: Partial<AfternoonTeaConversation> = {}): AfternoonTeaConversation {
  return {
    id: patch.id ?? 'conversation-a',
    title: patch.title ?? '下午茶会话',
    createdAt: patch.createdAt ?? 100,
    updatedAt: patch.updatedAt ?? 200,
    sourceImageId: patch.sourceImageId === undefined ? 'source-a' : patch.sourceImageId,
    sourceImageName: patch.sourceImageName ?? '下午茶.png',
    orderText: patch.orderText ?? '草莓蛋糕和红茶',
    titleCount: patch.titleCount ?? 3,
    systemPrompt: patch.systemPrompt ?? '系统提示词',
    analysisSystemPromptSnapshot: patch.analysisSystemPromptSnapshot ?? '分析系统提示词',
    analysisUserPromptSnapshot: patch.analysisUserPromptSnapshot ?? '分析用户提示词',
    orderResult: patch.orderResult === undefined ? {
      titles: ['午后茶歇'],
      items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
    } : patch.orderResult,
    posterItems: patch.posterItems ?? [{ id: 'poster-a', title: '午后茶歇', prompt: '海报提示词', taskId: 'task-a' }],
    batchStartedAt: patch.batchStartedAt ?? null,
    batchFinishedAt: patch.batchFinishedAt ?? null,
  }
}

function task(id: string, status: TaskRecord['status']): TaskRecord {
  return {
    id,
    prompt: '海报提示词',
    params: {
      size: 'auto',
      quality: 'auto',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      n: 1,
      transparent_output: false,
    },
    inputImageIds: [],
    outputImages: [],
    status,
    error: null,
    createdAt: 100,
    finishedAt: status === 'running' ? null : 400,
    elapsed: status === 'running' ? null : 300,
  }
}

describe('afternoon tea conversations', () => {
  it('normalizes imported conversations and discards invalid poster items', () => {
    const [normalized] = normalizeAfternoonTeaConversations([
      null,
      { id: '' },
      {
        id: 'conversation-a',
        title: '  ',
        createdAt: 100,
        updatedAt: 'invalid',
        sourceImageId: 'source-a',
        sourceImageName: 1,
        orderText: '订单内容',
        titleCount: 99,
        systemPrompt: '系统提示词',
        analysisSystemPromptSnapshot: 123,
        orderResult: {
          titles: [' 午后茶歇 ', 1],
          items: [
            { displayName: ' 草莓蛋糕 ', tags: [' 草莓 ', '', '草莓'] },
            { displayName: '', tags: [] },
          ],
        },
        posterItems: [
          { id: 'poster-a', title: ' 午后茶歇 ', prompt: ' 海报提示词 ', taskId: 1, setupError: ' 创建失败 ' },
          { id: '', title: '无效', prompt: '无效' },
          { id: 'poster-b', title: '', prompt: '无效' },
        ],
        batchStartedAt: 200,
        batchFinishedAt: 'invalid',
      },
    ], 500)

    expect(normalized).toEqual({
      id: 'conversation-a',
      title: '新下午茶会话',
      createdAt: 100,
      updatedAt: 500,
      sourceImageId: 'source-a',
      sourceImageName: '',
      orderText: '订单内容',
      titleCount: 10,
      systemPrompt: '系统提示词',
      analysisSystemPromptSnapshot: null,
      analysisUserPromptSnapshot: null,
      orderResult: {
        titles: ['午后茶歇'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
      posterItems: [{ id: 'poster-a', title: '午后茶歇', prompt: '海报提示词', setupError: '创建失败' }],
      batchStartedAt: 200,
      batchFinishedAt: null,
    })
  })

  it('keeps a complete valid conversation unchanged', () => {
    const valid: AfternoonTeaConversation = {
      id: 'conversation-complete',
      title: '周五下午茶',
      createdAt: 100,
      updatedAt: 500,
      sourceImageId: 'source-complete',
      sourceImageName: 'afternoon-tea.png',
      orderText: '草莓蛋糕和柠檬红茶',
      titleCount: 2,
      systemPrompt: '当前系统提示词',
      analysisSystemPromptSnapshot: '分析系统提示词快照',
      analysisUserPromptSnapshot: '分析用户提示词快照',
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        items: [
          { displayName: '草莓蛋糕', tags: ['草莓', '蛋糕'] },
          { displayName: '柠檬红茶', tags: ['柠檬', '红茶'] },
        ],
      },
      posterItems: [
        { id: 'poster-a', title: '午后茶歇', prompt: '海报提示词 A', taskId: 'task-a' },
        { id: 'poster-b', title: '暖心时光', prompt: '海报提示词 B', setupError: '任务创建失败' },
      ],
      batchStartedAt: 200,
      batchFinishedAt: 450,
    }

    expect(normalizeAfternoonTeaConversations([valid], 999)).toEqual([valid])
  })

  it.each([
    [undefined, 'missing'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    ['5', 'string'],
  ])('falls back to the shared default title count for %s values', (titleCount, _label) => {
    const [normalized] = normalizeAfternoonTeaConversations([{
      id: 'conversation-default-title-count',
      ...(titleCount === undefined ? {} : { titleCount }),
    }], 999)

    expect(normalized.titleCount).toBe(5)
    expect(normalizeAfternoonTeaTitleCount(titleCount)).toBe(5)
  })

  it('identifies and reuses only recently updated empty conversations', () => {
    const empty = conversation({
      sourceImageId: null,
      sourceImageName: '',
      orderText: '',
      orderResult: null,
      posterItems: [],
      batchStartedAt: null,
      batchFinishedAt: null,
      updatedAt: 1_000,
    })

    expect(isEmptyAfternoonTeaConversation(empty)).toBe(true)
    expect(canReuseRecentEmptyAfternoonTeaConversation(empty, 1_500, 1_000)).toBe(true)
    expect(canReuseRecentEmptyAfternoonTeaConversation(empty, 2_001, 1_000)).toBe(false)
    expect(canReuseRecentEmptyAfternoonTeaConversation(conversation(), 1_500, 1_000)).toBe(false)
  })

  it('builds search text from user-visible conversation content', () => {
    const value = conversation({
      title: '周五茶歇',
      sourceImageName: 'meeting.png',
      orderText: '红茶与蛋糕',
      orderResult: {
        titles: ['暖心时光'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓', '奶油'] }],
      },
      posterItems: [{ id: 'poster-a', title: '午后茶歇', prompt: '不要进入搜索文本' }],
    })

    expect(getAfternoonTeaConversationSearchText(value)).toContain('周五茶歇')
    expect(getAfternoonTeaConversationSearchText(value)).toContain('meeting.png')
    expect(getAfternoonTeaConversationSearchText(value)).toContain('红茶与蛋糕')
    expect(getAfternoonTeaConversationSearchText(value)).toContain('暖心时光')
    expect(getAfternoonTeaConversationSearchText(value)).toContain('草莓')
    expect(getAfternoonTeaConversationSearchText(value)).not.toContain('不要进入搜索文本')
  })

  it('collects unique source image ids from conversations', () => {
    expect(collectAfternoonTeaConversationSourceImageIds([
      conversation({ sourceImageId: 'source-a' }),
      conversation({ id: 'conversation-b', sourceImageId: 'source-b' }),
      conversation({ id: 'conversation-c', sourceImageId: 'source-a' }),
      conversation({ id: 'conversation-d', sourceImageId: null }),
    ])).toEqual(['source-a', 'source-b'])
  })

  it('returns elapsed only after this conversation poster tasks finish', () => {
    const value = conversation({ batchStartedAt: 100, batchFinishedAt: 500 })

    expect(getAfternoonTeaConversationBatchElapsed(value, [
      task('task-a', 'done'),
      task('other-batch-running', 'running'),
    ])).toBe(400)
    expect(getAfternoonTeaConversationBatchElapsed(value, [task('task-a', 'running')])).toBeNull()
  })

  it('clamps completed batch elapsed to zero', () => {
    const value = conversation({ batchStartedAt: 500, batchFinishedAt: 100 })

    expect(getAfternoonTeaConversationBatchElapsed(value, [task('task-a', 'error')])).toBe(0)
  })

  it('returns persisted elapsed for an interrupted batch with setup errors and missing tasks', () => {
    const value = conversation({
      posterItems: [
        { id: 'poster-setup-error', title: '创建失败', prompt: '提示词 A', setupError: '任务创建失败' },
        { id: 'poster-missing-task', title: '记录缺失', prompt: '提示词 B', taskId: 'missing-task' },
      ],
      batchStartedAt: 100,
      batchFinishedAt: 450,
    })

    expect(getAfternoonTeaConversationBatchElapsed(value, [
      task('unrelated-running-task', 'running'),
    ])).toBe(350)
  })

  it('keeps interrupted batch elapsed null until a finish time is persisted', () => {
    const value = conversation({
      posterItems: [
        { id: 'poster-setup-error', title: '创建失败', prompt: '提示词 A', setupError: '任务创建失败' },
        { id: 'poster-missing-task', title: '记录缺失', prompt: '提示词 B', taskId: 'missing-task' },
      ],
      batchStartedAt: 100,
      batchFinishedAt: null,
    })

    expect(getAfternoonTeaConversationBatchElapsed(value, [])).toBeNull()
  })
})
