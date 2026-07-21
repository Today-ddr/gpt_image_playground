import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import { useTooltip } from '../hooks/useTooltip'
import { CloseIcon, EditIcon, TrashIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'

export type ConversationHistoryItem = {
  id: string
  title: string
  updatedAt: number
  searchText: string
}

export type ConversationHistoryPopoverProps = {
  items: ConversationHistoryItem[]
  activeId: string | null
  editingId: string | null
  renameDisabledIds?: Record<string, boolean>
  confirmDialogOpen?: boolean
  ignoreOutsideClickRef?: RefObject<HTMLElement | null>
  searchPlaceholder?: string
  emptyText?: string
  positionClassName?: string
  now?: number
  onEditingIdChange: (id: string | null) => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function formatTime(value: number, nowValue: number) {
  const date = new Date(value)
  const now = new Date(nowValue)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const dayOfWeek = now.getDay() || 7
  const startOfWeek = startOfToday - (dayOfWeek - 1) * 24 * 60 * 60 * 1000
  const time = date.getTime()
  if (time >= startOfToday) return '今天'
  if (time >= startOfYesterday) return '昨天'
  if (time >= startOfWeek) return '本周'
  return '更早'
}

function formatDetailTime(value: number) {
  const date = new Date(value)
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(date).replace(/\//g, '-')
}

export function filterConversationHistoryItems(items: ConversationHistoryItem[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return [...items]
  return items.filter((item) => item.searchText.toLocaleLowerCase().includes(normalizedQuery))
}

export function groupConversationHistoryItems(items: ConversationHistoryItem[], now = Date.now()) {
  const groups = new Map<string, ConversationHistoryItem[]>()
  for (const item of [...items].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const label = formatTime(item.updatedAt, now)
    const group = groups.get(label)
    if (group) group.push(item)
    else groups.set(label, [item])
  }
  return [...groups.entries()].map(([label, groupedItems]) => ({ label, items: groupedItems }))
}

export function selectConversationHistoryItem(
  editingId: string | null,
  id: string,
  onSelect: (id: string) => void,
) {
  if (editingId) return false
  onSelect(id)
  return true
}

export function confirmConversationHistoryRename(
  editingId: string | null,
  title: string,
  renameDisabledIds: Record<string, boolean>,
  onRename: (id: string, title: string) => void,
  onEditingIdChange: (id: string | null) => void,
) {
  const trimmedTitle = title.trim()
  if (editingId && trimmedTitle && !renameDisabledIds[editingId]) onRename(editingId, trimmedTitle)
  onEditingIdChange(null)
}

export function deleteConversationHistoryItem(
  event: Pick<Event, 'stopPropagation'>,
  id: string,
  onDelete: (id: string) => void,
) {
  event.stopPropagation()
  onDelete(id)
}

type ContainsTarget = { contains: (target: Node | null) => boolean }

export function shouldCloseConversationHistory(
  confirmDialogOpen: boolean,
  target: Node | null,
  modal: ContainsTarget | null,
  ignored: ContainsTarget | null,
) {
  if (confirmDialogOpen || ignored?.contains(target)) return false
  return Boolean(modal && !modal.contains(target))
}

function HistoryActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  onMouseDown,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  onMouseDown?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  const tooltipState = useTooltip()

  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={tooltip}
        onClick={(e) => {
          tooltipState.dismiss()
          onClick?.(e)
        }}
        onMouseDown={(e) => {
          tooltipState.dismiss()
          onMouseDown?.(e)
        }}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export function ConversationHistoryPopover({
  items,
  activeId,
  editingId,
  renameDisabledIds = {},
  confirmDialogOpen = false,
  ignoreOutsideClickRef,
  searchPlaceholder = '搜索聊天...',
  emptyText = '没有找到匹配的聊天',
  positionClassName = 'absolute top-12 right-0 sm:left-0 sm:right-auto',
  now = Date.now(),
  onEditingIdChange,
  onSelect,
  onRename,
  onDelete,
  onClose,
}: ConversationHistoryPopoverProps) {
  const [editingTitle, setEditingTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef(items)
  const onEditingIdChangeRef = useRef(onEditingIdChange)
  itemsRef.current = items
  onEditingIdChangeRef.current = onEditingIdChange
  const filteredItems = useMemo(() => filterConversationHistoryItems(items, searchQuery), [items, searchQuery])
  const groups = useMemo(() => groupConversationHistoryItems(filteredItems, now), [filteredItems, now])

  useEffect(() => {
    const item = itemsRef.current.find((candidate) => candidate.id === editingId)
    setEditingTitle(item?.title ?? '')
  }, [editingId])

  useEffect(() => {
    return () => onEditingIdChangeRef.current(null)
  }, [])

  useEffect(() => {
    const handleInteract = (event: MouseEvent | TouchEvent) => {
      if (shouldCloseConversationHistory(
        confirmDialogOpen,
        event.target as Node | null,
        modalRef.current,
        ignoreOutsideClickRef?.current ?? null,
      )) onClose()
    }
    document.addEventListener('mousedown', handleInteract, { capture: true })
    document.addEventListener('touchstart', handleInteract, { capture: true })
    return () => {
      document.removeEventListener('mousedown', handleInteract, { capture: true })
      document.removeEventListener('touchstart', handleInteract, { capture: true })
    }
  }, [confirmDialogOpen, ignoreOutsideClickRef, onClose])

  const confirmRename = () => {
    confirmConversationHistoryRename(editingId, editingTitle, renameDisabledIds, onRename, onEditingIdChange)
  }

  const handleRenameKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      confirmRename()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onEditingIdChange(null)
    }
  }

  return (
    <div
      ref={modalRef}
      className={`${positionClassName} w-80 max-w-[calc(100vw-1rem)] sm:w-96 max-h-[70vh] bg-white dark:bg-[#1c1c1e] rounded-xl shadow-2xl overflow-hidden flex flex-col border border-gray-200 dark:border-white/10 z-50 text-gray-900 dark:text-gray-200 animate-dropdown-down`}
    >
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-white/10 shrink-0">
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm px-2 text-gray-900 dark:text-white placeholder-gray-400"
        />
        <HistoryActionButton tooltip="关闭" onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400 transition-colors">
          <CloseIcon className="w-4 h-4" />
        </HistoryActionButton>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 overscroll-contain">
        {filteredItems.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-gray-500">{emptyText}</div>
        )}

        {groups.map(({ label, items: groupedItems }) => (
          <div key={label}>
            <div className="mt-4 mb-1 px-3 text-xs font-medium text-gray-500">{label}</div>
            {groupedItems.map((item) => (
              <div
                key={item.id}
                className="group flex h-14 items-center justify-between gap-2 rounded-lg px-3 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                onClick={() => selectConversationHistoryItem(editingId, item.id, onSelect)}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <svg className="w-4 h-4 shrink-0 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {editingId === item.id ? (
                    <input
                      type="text"
                      className="h-7 flex-1 min-w-0 bg-white dark:bg-black/20 border border-blue-400/50 dark:border-white/20 rounded px-1.5 py-0 text-sm leading-7 outline-none text-gray-900 dark:text-white focus:border-blue-500 dark:focus:border-white/40 shadow-sm"
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onKeyDown={handleRenameKeyDown}
                      onClick={(event) => event.stopPropagation()}
                      autoFocus
                      onBlur={confirmRename}
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm truncate ${item.id === activeId ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-600 dark:text-gray-300'}`}>
                        {item.title}
                      </div>
                      <div className="hidden sm:block mt-0.5 text-[11px] leading-none text-gray-500">
                        {formatDetailTime(item.updatedAt)}
                      </div>
                    </div>
                  )}
                </div>
                <div className={`flex shrink-0 items-center justify-end gap-1 overflow-hidden transition-all duration-150 ${editingId === item.id ? 'w-7 opacity-100' : 'w-16 opacity-100 sm:w-0 sm:opacity-0 sm:group-hover:w-16 sm:group-hover:opacity-100 sm:group-focus-within:w-16 sm:group-focus-within:opacity-100'}`}>
                  {editingId === item.id ? (
                    <HistoryActionButton
                      tooltip="确认"
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); confirmRename() }}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md text-green-500 dark:text-green-400 hover:text-green-600 dark:hover:text-green-300 transition-colors"
                    >
                      <span aria-hidden="true">✓</span>
                    </HistoryActionButton>
                  ) : (
                    <>
                      <HistoryActionButton
                        tooltip="重命名"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (!renameDisabledIds[item.id]) onEditingIdChange(item.id)
                        }}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-white disabled:text-gray-300 disabled:hover:text-gray-300 dark:disabled:text-gray-600 dark:disabled:hover:text-gray-600 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                        disabled={Boolean(renameDisabledIds[item.id])}
                      >
                        <EditIcon className="w-3.5 h-3.5" />
                      </HistoryActionButton>
                      <HistoryActionButton
                        tooltip="删除"
                        onClick={(event) => deleteConversationHistoryItem(event, item.id, onDelete)}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </HistoryActionButton>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
