import { describe, expect, it } from 'vitest'

import {
  buildAgentHistoryDeleteDialog,
  buildAgentHistoryItems,
  getAgentHistoryDeletePreview,
  renameAgentHistoryConversation,
  selectAgentHistoryConversation,
} from './HistoryModal'
import type { AgentConversation, TaskRecord } from '../types'

function conversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: 'conversation-1',
    title: '下午茶设计',
    activeRoundId: null,
    createdAt: 1,
    updatedAt: 2,
    rounds: [],
    messages: [],
    ...overrides,
  }
}

function task(id: string, outputImages: string[] = []): TaskRecord {
  return {
    id,
    prompt: 'prompt',
    params: {} as TaskRecord['params'],
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages,
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  }
}

describe('HistoryModal Agent adapter', () => {
  it('adapts Agent conversations into searchable generic items', () => {
    const result = buildAgentHistoryItems([conversation()])

    expect(result).toEqual([expect.objectContaining({
      id: 'conversation-1',
      title: '下午茶设计',
      updatedAt: 2,
      searchText: expect.stringContaining('下午茶设计'),
    })])
  })

  it('summarizes related tasks and generated images for the delete confirmation', () => {
    const target = conversation({
      activeRoundId: 'round-1',
      rounds: [{
        id: 'round-1',
        index: 0,
        parentRoundId: null,
        userMessageId: 'message-1',
        prompt: '生成下午茶图片',
        inputImageIds: [],
        outputTaskIds: ['task-1', 'task-2'],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
    })

    expect(getAgentHistoryDeletePreview(target, [
      task('task-1', ['img-1', 'img-2']),
      task('task-2', ['img-2']),
    ])).toEqual({
      relatedTaskIds: ['task-1', 'task-2'],
      generatedImageCount: 2,
    })
  })

  it('switches to Agent mode and selects only when no rename is active', () => {
    const calls: string[] = []
    selectAgentHistoryConversation('conversation-1', null, {
      setAppMode: (mode) => calls.push(mode),
      setActiveConversationId: (id) => calls.push(id),
      onClose: () => calls.push('close'),
    })
    selectAgentHistoryConversation('conversation-2', 'editing', {
      setAppMode: (mode) => calls.push(mode),
      setActiveConversationId: (id) => calls.push(id),
      onClose: () => calls.push('close'),
    })
    expect(calls).toEqual(['agent', 'conversation-1', 'close'])
  })

  it('respects rename disable and builds the optional related-task delete action', async () => {
    const renameCalls: string[] = []
    renameAgentHistoryConversation('conversation-1', '新标题', {}, {
      renameConversation: (id, title) => renameCalls.push(`${id}:${title}`),
      setEditingId: (id) => renameCalls.push(String(id)),
    })
    renameAgentHistoryConversation('conversation-1', '被禁用', { 'conversation-1': true }, {
      renameConversation: (id, title) => renameCalls.push(`${id}:${title}`),
      setEditingId: (id) => renameCalls.push(String(id)),
    })
    expect(renameCalls).toEqual(['conversation-1:新标题', 'null', 'null'])

    const target = conversation({
      activeRoundId: 'round-1',
      rounds: [{
        id: 'round-1',
        index: 0,
        parentRoundId: null,
        userMessageId: 'message-1',
        prompt: '生成图片',
        inputImageIds: [],
        outputTaskIds: ['task-1'],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
    })
    const actionCalls: string[] = []
    const dialog = buildAgentHistoryDeleteDialog('conversation-1', [target], [task('task-1', ['img-1'])], {
      removeTasks: async (ids) => { actionCalls.push(`remove:${ids.join(',')}`) },
      deleteConversation: (id) => actionCalls.push(`delete:${id}`),
      onClose: () => actionCalls.push('close'),
    })

    expect(dialog.checkbox?.label).toContain('1 张')
    await dialog.action?.(true)
    expect(actionCalls).toEqual(['remove:task-1', 'delete:conversation-1', 'close'])
  })
})
