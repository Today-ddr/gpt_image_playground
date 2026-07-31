import { describe, expect, it } from 'vitest'
import { normalizeAfternoonTeaConversations } from './afternoonTeaConversations'
import { createDefaultAfternoonTeaItemTitleRegions } from './afternoonTeaTitlePlacement'

describe('afternoon tea item region conversation contract', () => {
  it('fills one item region per parsed order item when an old session has no regions', () => {
    const [conversation] = normalizeAfternoonTeaConversations([{
      id: 'old-session',
      orderResult: {
        titles: ['今日下午茶'],
        items: [
          { displayName: '蟹肉沙拉紫菜包饭', tags: [] },
          { displayName: '金枪鱼紫菜包饭', tags: [] },
        ],
      },
    }], 100)

    expect(conversation.itemTitleRegions).toEqual(createDefaultAfternoonTeaItemTitleRegions(2))
  })

  it('normalizes edited names into unstarted poster prompts while preserving tags', () => {
    const [conversation] = normalizeAfternoonTeaConversations([{
      id: 'editable-session',
      itemTitleRegions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.2 }],
      orderResult: {
        titles: ['今日下午茶'],
        items: [{ displayName: '蟹肉紫菜包饭', tags: ['蟹肉', '紫菜'] }],
      },
      posterItems: [{ id: 'poster-1', title: '今日下午茶', prompt: 'old prompt' }],
      batchStartedAt: null,
      batchFinishedAt: null,
    }], 100)

    expect(conversation.itemTitleRegions).toEqual([{ x: 0.1, y: 0.2, width: 0.3, height: 0.2 }])
    expect(conversation.posterItems[0]?.prompt).toContain('蟹肉紫菜包饭')
    expect(conversation.posterItems[0]?.prompt).toContain('"left": 10')
  })

  it('keeps valid item region drafts while the same image is waiting to be reparsed', () => {
    const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.2 }
    const [conversation] = normalizeAfternoonTeaConversations([{
      id: 'same-image-reparse',
      sourceImageId: 'image-a',
      orderResult: null,
      itemTitleRegions: [region],
    }], 100)

    expect(conversation.itemTitleRegions).toEqual([region])
  })
})
