import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import popoverSource from './ConversationHistoryPopover.tsx?raw'

import {
  confirmConversationHistoryRename,
  ConversationHistoryPopover,
  deleteConversationHistoryItem,
  filterConversationHistoryItems,
  groupConversationHistoryItems,
  selectConversationHistoryItem,
  shouldCloseConversationHistory,
  type ConversationHistoryItem,
} from './ConversationHistoryPopover'

const NOW = new Date(2026, 6, 21, 12).getTime()
const items: ConversationHistoryItem[] = [
  { id: 'older', title: '旧会话', updatedAt: NOW - 10 * 24 * 60 * 60 * 1000, searchText: '旧会话订单' },
  { id: 'newer', title: '今日茶歇', updatedAt: NOW - 1000, searchText: '今日茶歇 香芋' },
]

describe('ConversationHistoryPopover', () => {
  it('sorts, filters and groups injected history items without changing the source array', () => {
    expect(filterConversationHistoryItems(items, '香芋').map((item) => item.id)).toEqual(['newer'])
    expect(groupConversationHistoryItems(items, NOW)).toEqual([
      { label: '今天', items: [items[1]] },
      { label: '更早', items: [items[0]] },
    ])
    expect(items.map((item) => item.id)).toEqual(['older', 'newer'])
  })

  it('renders injected titles, search placeholder, active state and action labels', () => {
    const html = renderToStaticMarkup(
      <ConversationHistoryPopover
        items={items}
        activeId="newer"
        editingId={null}
        onEditingIdChange={() => undefined}
        onSelect={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
        onClose={() => undefined}
        searchPlaceholder="搜索餐品会话..."
        emptyText="没有找到匹配的餐品会话"
        now={NOW}
      />,
    )

    expect(html).toContain('搜索餐品会话...')
    expect(html).toContain('今日茶歇')
    expect(html).toContain('旧会话')
    expect(html).toContain('aria-label="重命名"')
    expect(html).toContain('aria-label="删除"')
    expect(html).toContain('text-gray-900')
    expect(html).toContain('s9 3.582 9 8z')
    expect(html).toContain('absolute top-12 right-0 sm:left-0 sm:right-auto')
    expect(html).toContain('max-w-[calc(100vw-1rem)]')
  })

  it('routes selection, rename and delete through the injected callbacks', () => {
    const selected: string[] = []
    expect(selectConversationHistoryItem(null, 'newer', (id) => selected.push(id))).toBe(true)
    expect(selectConversationHistoryItem('older', 'newer', (id) => selected.push(id))).toBe(false)
    expect(selected).toEqual(['newer'])

    const renamed: Array<[string, string]> = []
    const editing: Array<string | null> = []
    confirmConversationHistoryRename('newer', '  新标题  ', {}, (id, title) => renamed.push([id, title]), (id) => editing.push(id))
    confirmConversationHistoryRename('older', '禁用标题', { older: true }, (id, title) => renamed.push([id, title]), (id) => editing.push(id))
    expect(renamed).toEqual([['newer', '新标题']])
    expect(editing).toEqual([null, null])

    let stopped = false
    const deleted: string[] = []
    deleteConversationHistoryItem({ stopPropagation: () => { stopped = true } }, 'older', (id) => deleted.push(id))
    expect(stopped).toBe(true)
    expect(deleted).toEqual(['older'])
  })

  it('closes only for an outside interaction when no confirmation is open', () => {
    const inside = {} as Node
    const trigger = {} as Node
    const outside = {} as Node
    const modal = { contains: (target: Node | null) => target === inside }
    const ignored = { contains: (target: Node | null) => target === trigger }

    expect(shouldCloseConversationHistory(false, outside, modal, ignored)).toBe(true)
    expect(shouldCloseConversationHistory(false, inside, modal, ignored)).toBe(false)
    expect(shouldCloseConversationHistory(false, trigger, modal, ignored)).toBe(false)
    expect(shouldCloseConversationHistory(true, outside, modal, ignored)).toBe(false)
  })

  it('does not reset an in-progress rename when equivalent props rerender', () => {
    expect(popoverSource).toContain('const itemsRef = useRef(items)')
    expect(popoverSource).toContain('itemsRef.current = items')
    expect(popoverSource).toMatch(/setEditingTitle\(item\?\.title \?\? ''\)[\s\S]*?}, \[editingId\]\)/)
    expect(popoverSource).toContain('const onEditingIdChangeRef = useRef(onEditingIdChange)')
    expect(popoverSource).toMatch(/return \(\) => onEditingIdChangeRef\.current\(null\)[\s\S]*?}, \[\]\)/)
    expect(popoverSource).toContain('w-16 opacity-100 sm:w-0 sm:opacity-0')
  })
})
