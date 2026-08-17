import { describe, expect, it } from 'vitest'

import type { AfternoonTeaConversation, TaskRecord } from '../types'
import * as conversationHelpers from './afternoonTeaConversations'
import {
  canReuseRecentEmptyAfternoonTeaConversation,
  collectAfternoonTeaConversationSourceImageIds,
  createAfternoonTeaItemTitleRegionsPatch,
  createAfternoonTeaSourceImagePatch,
  createAfternoonTeaOrderItemNamePatch,
  createAfternoonTeaOrderItemTagsPatch,
  createAfternoonTeaOrderTitlePatch,
  getAfternoonTeaConversationBatchElapsed,
  getAfternoonTeaConversationSearchText,
  isAfternoonTeaConversationFrozen,
  isEmptyAfternoonTeaConversation,
  normalizeAfternoonTeaTitleCount,
  normalizeAfternoonTeaConversations,
} from './afternoonTeaConversations'
import { DEFAULT_AFTERNOON_TEA_TITLE_REGION, createDefaultAfternoonTeaItemTitleRegions } from './afternoonTeaTitlePlacement'

const reconcileAfternoonTeaConversationBatch = (
  value: AfternoonTeaConversation,
  tasks: TaskRecord[],
  now: number,
  options?: { interruptUnclaimed?: boolean },
) => (conversationHelpers as typeof conversationHelpers & {
  reconcileAfternoonTeaConversationBatch?: (
    conversation: AfternoonTeaConversation,
    tasks: TaskRecord[],
    now: number,
    options?: { interruptUnclaimed?: boolean },
  ) => AfternoonTeaConversation
}).reconcileAfternoonTeaConversationBatch?.(value, tasks, now, options) ?? value

const createAfternoonTeaOrderTitlesPatch = (
  value: AfternoonTeaConversation,
  titles: string[],
) => (conversationHelpers as typeof conversationHelpers & {
  createAfternoonTeaOrderTitlesPatch?: (
    conversation: AfternoonTeaConversation,
    titles: string[],
  ) => Pick<AfternoonTeaConversation, 'orderResult' | 'posterItems'> | null
}).createAfternoonTeaOrderTitlesPatch?.(value, titles)

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
    itemTitleRegions: patch.itemTitleRegions ?? (patch.orderResult === null ? [] : [{ ...DEFAULT_AFTERNOON_TEA_TITLE_REGION }]),
    systemPrompt: patch.systemPrompt ?? '系统提示词',
    analysisSystemPromptSnapshot: patch.analysisSystemPromptSnapshot ?? '分析系统提示词',
    analysisUserPromptSnapshot: patch.analysisUserPromptSnapshot ?? '分析用户提示词',
    analysisElapsed: patch.analysisElapsed ?? null,
    orderResult: patch.orderResult === undefined ? {
      titles: ['午后茶歇'],
      items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
    } : patch.orderResult,
    posterItems: patch.posterItems ?? [{ id: 'poster-a', title: '午后茶歇', prompt: '海报提示词', taskId: 'task-a' }],
    batchStartedAt: patch.batchStartedAt ?? null,
    batchFinishedAt: patch.batchFinishedAt ?? null,
  }
}

function task(id: string, status: TaskRecord['status'], finishedAt = status === 'running' ? null : 400): TaskRecord {
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
    finishedAt,
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
        analysisElapsed: 65_000,
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
      itemTitleRegions: [{ ...DEFAULT_AFTERNOON_TEA_TITLE_REGION }],
      systemPrompt: '系统提示词',
      analysisSystemPromptSnapshot: null,
      analysisUserPromptSnapshot: null,
      analysisElapsed: 65_000,
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
      itemTitleRegions: [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
        { x: 0.55, y: 0.6, width: 0.3, height: 0.2 },
      ],
      systemPrompt: '当前系统提示词',
      analysisSystemPromptSnapshot: '分析系统提示词快照',
      analysisUserPromptSnapshot: '分析用户提示词快照',
      analysisElapsed: 65_000,
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

  it('persists title candidates when normalizing a stored conversation', () => {
    const [normalized] = normalizeAfternoonTeaConversations([{
      id: 'conversation-title-candidates',
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        titleCandidates: [' 今日小食 ', '午后茶歇', '暖心时光'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
    }], 999)

    expect(normalized.orderResult?.titleCandidates).toEqual(['午后茶歇', '暖心时光', '今日小食'])
  })

  it.each([
    [undefined, 'missing'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    ['7', 'string'],
  ])('falls back to the shared default title count for %s values', (titleCount, _label) => {
    const [normalized] = normalizeAfternoonTeaConversations([{
      id: 'conversation-default-title-count',
      ...(titleCount === undefined ? {} : { titleCount }),
    }], 999)

    expect(normalized.titleCount).toBe(4)
    expect(normalizeAfternoonTeaTitleCount(titleCount)).toBe(4)
  })

  it('fills one default title region per item when an imported conversation has no regions', () => {
    const [normalized] = normalizeAfternoonTeaConversations([{
      id: 'conversation-default-title-region',
      orderResult: {
        titles: ['午后茶歇'],
        items: [
          { displayName: '草莓蛋糕', tags: [] },
          { displayName: '柠檬红茶', tags: [] },
        ],
      },
    }], 999)

    expect(normalized.itemTitleRegions).toEqual(createDefaultAfternoonTeaItemTitleRegions(2))
  })

  it('rebuilds prompts for an old unstarted conversation with the default placement', () => {
    const [normalized] = normalizeAfternoonTeaConversations([{
      id: 'conversation-old-prompt',
      orderResult: {
        titles: ['午后茶歇'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
      posterItems: [{ id: 'poster-a', title: '午后茶歇', prompt: '旧版没有位置数据' }],
      batchStartedAt: null,
      batchFinishedAt: null,
    }], 999)

    expect(normalized.posterItems[0]?.prompt).toContain('"left": 29')
    expect(normalized.posterItems[0]?.prompt).toContain('"bottom": 22')
  })

  it('clears stale poster claims when restoring an explicitly editable conversation', () => {
    const [normalized] = normalizeAfternoonTeaConversations([{
      id: 'conversation-editable-stale-claims',
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
      posterItems: [
        { id: 'poster-a', title: '旧标题 A', prompt: '旧 prompt A', taskId: 'stale-task' },
        { id: 'poster-b', title: '旧标题 B', prompt: '旧 prompt B', setupError: '旧创建失败' },
      ],
      batchStartedAt: null,
      batchFinishedAt: null,
    }], 999)

    expect(normalized.posterItems.map((item) => item.id)).toEqual(['poster-a', 'poster-b'])
    expect(normalized.posterItems.map((item) => item.title)).toEqual(['午后茶歇', '暖心时光'])
    expect(normalized.posterItems.every((item) => !item.taskId && !item.setupError)).toBe(true)
    expect(normalized.posterItems[0].prompt).toContain('"title": "午后茶歇"')
    expect(normalized.posterItems[1].prompt).toContain('"title": "暖心时光"')
  })

  it.each([
    [{ x: -0.3, y: 0.1, width: 0.4, height: 0.2 }, 'pin overflow left'],
    [{ x: 0.7, y: 0.1, width: 0.91, height: 0.2 }, 'pin overflow right'],
    [{ x: Number.NaN, y: 0.1, width: 0.4, height: 0.2 }, 'NaN'],
    [{ x: 0.1, y: Number.POSITIVE_INFINITY, width: 0.4, height: 0.2 }, 'Infinity'],
  ])('normalizes invalid imported item title regions to the indexed default for %s', (titleRegion, _label) => {
    const [normalized] = normalizeAfternoonTeaConversations([{
      id: 'conversation-invalid-title-region',
      orderResult: {
        titles: ['午后茶歇'],
        items: [{ displayName: '草莓蛋糕', tags: [] }],
      },
      itemTitleRegions: [titleRegion],
    }], 999)

    expect(normalized.itemTitleRegions).toEqual([{ ...DEFAULT_AFTERNOON_TEA_TITLE_REGION }])
  })

  it('atomically rebuilds prompts before a batch starts and refuses updates after it starts', () => {
    const editable = conversation({
      batchStartedAt: null,
      posterItems: [
        { id: 'poster-a', title: '午后茶歇', prompt: '旧位置 A' },
      ],
    })
    const nextRegions = [{ x: 0.1, y: 0.2, width: 0.3, height: 0.2 }]
    const patch = createAfternoonTeaItemTitleRegionsPatch(editable, nextRegions)

    expect(patch?.itemTitleRegions).toEqual(nextRegions)
    expect(patch?.posterItems).toHaveLength(1)
    expect(patch?.posterItems[0]).toMatchObject({ id: 'poster-a', title: '午后茶歇' })
    expect(patch?.posterItems[0].prompt).toContain('"left": 10')
    expect(createAfternoonTeaItemTitleRegionsPatch({ ...editable, batchStartedAt: 100 }, nextRegions)).toBeNull()
  })

  it('keeps parsed order results when attaching or replacing a source image', () => {
    const parsed = conversation({
      sourceImageId: null,
      sourceImageName: '',
      itemTitleRegions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.2 }],
      posterItems: [{ id: 'poster-a', title: '午后茶歇', prompt: '旧位置' }],
    })
    const attached = createAfternoonTeaSourceImagePatch(parsed, 'source-b', 'later.png')

    expect(attached).toMatchObject({
      sourceImageId: 'source-b',
      sourceImageName: 'later.png',
    })
    expect(attached?.itemTitleRegions).toEqual(createDefaultAfternoonTeaItemTitleRegions(1))
    expect(attached?.posterItems?.[0]).toMatchObject({ id: 'poster-a', title: '午后茶歇' })
    expect(attached?.posterItems?.[0].prompt).toContain('"left": 29')
    expect(createAfternoonTeaSourceImagePatch({ ...parsed, batchStartedAt: 100 }, 'source-b', 'later.png')).toBeNull()
  })

  it('clears only the image fields when a parsed conversation loses its source image', () => {
    const parsed = conversation({
      sourceImageId: 'source-a',
      sourceImageName: 'tea.png',
      itemTitleRegions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.2 }],
    })
    const removed = createAfternoonTeaSourceImagePatch(parsed, null, '')

    expect(removed).toEqual({
      sourceImageId: null,
      sourceImageName: '',
      itemTitleRegions: [],
    })
    expect(removed).not.toHaveProperty('posterItems')
    expect(removed).not.toHaveProperty('orderResult')
  })

  it('does not invent title regions when attaching an image before analysis', () => {
    const unparsed = conversation({
      sourceImageId: null,
      sourceImageName: '',
      orderResult: null,
      itemTitleRegions: [],
      posterItems: [],
    })
    const attached = createAfternoonTeaSourceImagePatch(unparsed, 'source-b', 'later.png')

    expect(attached).toEqual({
      sourceImageId: 'source-b',
      sourceImageName: 'later.png',
      itemTitleRegions: [],
    })
  })

  it('edits one item display name without changing tags or frozen batches', () => {
    const editable = conversation({ batchStartedAt: null, posterItems: [{ id: 'poster-a', title: '午后茶歇', prompt: '旧名称' }] })
    const patch = createAfternoonTeaOrderItemNamePatch(editable, 0, ' 草莓奶油蛋糕 ')

    expect(patch?.orderResult?.items[0]).toEqual({ displayName: '草莓奶油蛋糕', tags: ['草莓'] })
    expect(patch?.posterItems[0].prompt).toContain('草莓奶油蛋糕')
    expect(createAfternoonTeaOrderItemNamePatch(editable, 0, '  ')).toBeNull()
    expect(createAfternoonTeaOrderItemNamePatch({ ...editable, batchStartedAt: 100 }, 0, '新名称')).toBeNull()
  })

  it('updates order item tags, rebuilds unfrozen prompts, and rejects frozen batches', () => {
    const editable = conversation({
      posterItems: [{ id: 'poster-a', title: '午后茶歇', prompt: '旧 tags prompt' }],
    })
    const patch = createAfternoonTeaOrderItemTagsPatch(editable, 0, [' 奶油 ', '', '草莓', '奶油'])

    expect(patch?.orderResult?.items[0]).toEqual({ displayName: '草莓蛋糕', tags: ['奶油', '草莓'] })
    expect(patch?.posterItems[0].prompt).toContain('奶油')
    expect(patch?.posterItems[0].prompt).toContain('草莓')
    expect(createAfternoonTeaOrderItemTagsPatch(editable, 0, ['草莓'])).toBeNull()
    expect(createAfternoonTeaOrderItemTagsPatch(editable, 1, ['奶油'])).toBeNull()
    expect(createAfternoonTeaOrderItemTagsPatch({ ...editable, batchStartedAt: 100 }, 0, ['奶油'])).toBeNull()
  })

  it('updates one trimmed poster title and rebuilds the matching prompt without changing title count', () => {
    const editable = conversation({
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
      itemTitleRegions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.2 }],
      posterItems: [
        { id: 'poster-a', title: '午后茶歇', prompt: '旧标题 A', taskId: 'stale-task' },
        { id: 'poster-b', title: '暖心时光', prompt: '旧标题 B', setupError: '旧创建失败' },
      ],
    })
    const patch = createAfternoonTeaOrderTitlePatch(editable, 1, ' 周末欢聚 ')

    expect(patch?.orderResult?.titles).toEqual(['午后茶歇', '周末欢聚'])
    expect(patch?.orderResult?.titles).toHaveLength(2)
    expect(patch?.posterItems[1]).toMatchObject({ id: 'poster-b', title: '周末欢聚' })
    expect(patch?.posterItems[1].prompt).toContain('"title": "周末欢聚"')
    expect(patch?.posterItems[1].prompt).toContain('"left": 10')
    expect(patch?.posterItems[1].prompt).not.toContain('暖心时光')
  })

  it('atomically swaps all poster titles and rebuilds every prompt from the final order', () => {
    const editable = conversation({
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
      posterItems: [
        { id: 'poster-a', title: '午后茶歇', prompt: '旧标题 A', taskId: 'stale-task' },
        { id: 'poster-b', title: '暖心时光', prompt: '旧标题 B', setupError: '旧创建失败' },
      ],
    })
    const patch = createAfternoonTeaOrderTitlesPatch(editable, [' 暖心时光 ', ' 午后茶歇 '])

    expect(patch?.orderResult?.titles).toEqual(['暖心时光', '午后茶歇'])
    expect(patch?.posterItems.map((item) => ({ id: item.id, title: item.title }))).toEqual([
      { id: 'poster-a', title: '暖心时光' },
      { id: 'poster-b', title: '午后茶歇' },
    ])
    expect(patch?.posterItems[0].prompt).toContain('"title": "暖心时光"')
    expect(patch?.posterItems[0].prompt).not.toContain('"title": "午后茶歇"')
    expect(patch?.posterItems[1].prompt).toContain('"title": "午后茶歇"')
    expect(patch?.posterItems[1].prompt).not.toContain('"title": "暖心时光"')
    expect(patch?.posterItems.every((item) => !item.taskId && !item.setupError)).toBe(true)
  })

  it('keeps existing title candidates when swapping selected poster titles', () => {
    const editable = conversation({
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        titleCandidates: ['午后茶歇', '暖心时光', '今日小食', '本周甜品'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
    })
    const patch = createAfternoonTeaOrderTitlesPatch(editable, ['今日小食', '暖心时光'])

    expect(patch?.orderResult?.titles).toEqual(['今日小食', '暖心时光'])
    expect(patch?.orderResult?.titleCandidates).toEqual(['午后茶歇', '暖心时光', '今日小食', '本周甜品'])
  })

  it('adds a handwritten title into the candidate pool', () => {
    const editable = conversation({
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        titleCandidates: ['午后茶歇', '暖心时光', '今日小食'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
    })
    const patch = createAfternoonTeaOrderTitlePatch(editable, 1, ' 周末甜品 ')

    expect(patch?.orderResult?.titles).toEqual(['午后茶歇', '周末甜品'])
    expect(patch?.orderResult?.titleCandidates).toEqual(['午后茶歇', '暖心时光', '今日小食', '周末甜品'])
  })

  it('starts a candidate pool from previous titles when a handwritten title is new', () => {
    const editable = conversation({
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
    })
    const patch = createAfternoonTeaOrderTitlePatch(editable, 0, '本周茶歇')

    expect(patch?.orderResult?.titles).toEqual(['本周茶歇', '暖心时光'])
    expect(patch?.orderResult?.titleCandidates).toEqual(['午后茶歇', '暖心时光', '本周茶歇'])
  })

  it.each([
    ['empty title', ['午后茶歇', '  '], {}],
    ['duplicate title', ['午后茶歇', ' 午后茶歇 '], {}],
    ['shorter title list', ['午后茶歇'], {}],
    ['longer title list', ['午后茶歇', '暖心时光', '周末欢聚'], {}],
    ['started batch', ['周末欢聚', '暖心时光'], { batchStartedAt: 300 }],
    ['finished batch', ['周末欢聚', '暖心时光'], { batchFinishedAt: 400 }],
  ])('rejects an atomic poster title update for %s', (_label, titles, state) => {
    const editable = conversation({
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
      ...state,
    })

    expect(createAfternoonTeaOrderTitlesPatch(editable, titles)).toBeNull()
  })

  it.each([
    ['empty title', 0, '  ', {}],
    ['duplicate title', 0, ' 暖心时光 ', {}],
    ['negative index', -1, '周末欢聚', {}],
    ['upper-bound index', 2, '周末欢聚', {}],
    ['non-integer index', 0.5, '周末欢聚', {}],
    ['started batch', 0, '周末欢聚', { batchStartedAt: 300 }],
    ['finished batch', 0, '周末欢聚', { batchFinishedAt: 400 }],
  ])('rejects a poster title update for %s', (_label, index, title, state) => {
    const editable = conversation({
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
      ...state,
    })

    expect(createAfternoonTeaOrderTitlePatch(editable, index, title)).toBeNull()
  })

  it('treats both started and finished poster batches as frozen', () => {
    expect(isAfternoonTeaConversationFrozen(conversation({ batchStartedAt: null, batchFinishedAt: null }))).toBe(false)
    expect(isAfternoonTeaConversationFrozen(conversation({ batchStartedAt: 100, batchFinishedAt: null }))).toBe(true)
    expect(isAfternoonTeaConversationFrozen(conversation({ batchStartedAt: null, batchFinishedAt: 200 }))).toBe(true)
  })

  it('clamps and floors valid numeric title counts', () => {
    expect(normalizeAfternoonTeaTitleCount(0)).toBe(1)
    expect(normalizeAfternoonTeaTitleCount(11)).toBe(10)
    expect(normalizeAfternoonTeaTitleCount(7.9)).toBe(7)
  })

  it.each([
    [undefined, 'missing'],
    [-1, 'negative'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    ['65000', 'string'],
  ])('discards invalid analysis elapsed values for %s', (analysisElapsed, _label) => {
    const [normalized] = normalizeAfternoonTeaConversations([{
      id: 'conversation-invalid-analysis-elapsed',
      ...(analysisElapsed === undefined ? {} : { analysisElapsed }),
    }], 999)

    expect(normalized.analysisElapsed).toBeNull()
  })

  it('discards analysis elapsed when there is no valid result', () => {
    const [normalized] = normalizeAfternoonTeaConversations([{
      id: 'conversation-orphan-analysis-elapsed',
      analysisElapsed: 65_000,
      orderResult: null,
    }], 999)

    expect(normalized.orderResult).toBeNull()
    expect(normalized.analysisElapsed).toBeNull()
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

  it('keeps frozen elapsed when a replacement retry task is running', () => {
    const value = conversation({ batchStartedAt: 100, batchFinishedAt: 500 })

    expect(getAfternoonTeaConversationBatchElapsed(value, [
      task('task-a', 'done'),
      task('other-batch-running', 'running'),
    ])).toBe(400)
    expect(getAfternoonTeaConversationBatchElapsed(value, [task('task-a', 'running')])).toBe(400)
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

  it('does not finish while a linked task is running or an item is unclaimed', () => {
    const value = conversation({
      posterItems: [
        { id: 'running', title: '生成中', prompt: '提示词 A', taskId: 'task-running' },
        { id: 'queued', title: '等待', prompt: '提示词 B' },
      ],
      batchStartedAt: 100,
    })

    expect(reconcileAfternoonTeaConversationBatch(value, [task('task-running', 'running')], 500)).toBe(value)
  })

  it('finishes when setup errors, done/error tasks, and missing linked tasks are all terminal', () => {
    const value = conversation({
      posterItems: [
        { id: 'setup', title: '创建失败', prompt: '提示词 A', setupError: '创建失败' },
        { id: 'done', title: '成功', prompt: '提示词 B', taskId: 'task-done' },
        { id: 'error', title: '失败', prompt: '提示词 C', taskId: 'task-error' },
        { id: 'missing', title: '缺失', prompt: '提示词 D', taskId: 'task-missing' },
      ],
      batchStartedAt: 100,
    })
    const reconciled = reconcileAfternoonTeaConversationBatch(value, [
      task('task-done', 'done', 420),
      task('task-error', 'error', 460),
      task('same-batch-extra', 'done', 900),
    ], 500)

    expect(reconciled.batchFinishedAt).toBe(460)
  })

  it('uses reconciliation time when terminal items have no linked finished timestamp', () => {
    const value = conversation({
      posterItems: [
        { id: 'setup', title: '创建失败', prompt: '提示词 A', setupError: '创建失败' },
        { id: 'missing', title: '缺失', prompt: '提示词 B', taskId: 'task-missing' },
      ],
      batchStartedAt: 100,
    })

    expect(reconcileAfternoonTeaConversationBatch(value, [], 550).batchFinishedAt).toBe(550)
  })

  it('marks only unclaimed items interrupted during recovery', () => {
    const value = conversation({
      posterItems: [
        { id: 'unclaimed', title: '等待', prompt: '提示词 A' },
        { id: 'claimed', title: '生成中', prompt: '提示词 B', taskId: 'task-running' },
      ],
      batchStartedAt: 100,
    })
    const reconciled = reconcileAfternoonTeaConversationBatch(value, [task('task-running', 'running')], 600, {
      interruptUnclaimed: true,
    })

    expect(reconciled.posterItems).toEqual([
      { id: 'unclaimed', title: '等待', prompt: '提示词 A', setupError: '上次批次已中断' },
      { id: 'claimed', title: '生成中', prompt: '提示词 B', taskId: 'task-running' },
    ])
    expect(reconciled.batchFinishedAt).toBeNull()
  })

  it('never overwrites an existing batch finish', () => {
    const value = conversation({ batchStartedAt: 100, batchFinishedAt: 450 })

    expect(reconcileAfternoonTeaConversationBatch(value, [task('task-a', 'done', 900)], 1_000)).toBe(value)
  })
})
