import { getAgentConversationTaskIds, removeMultipleTasks, useStore } from '../store'
import type { AgentConversation, TaskRecord } from '../types'
import { ConversationHistoryPopover, type ConversationHistoryItem } from './ConversationHistoryPopover'

export function getConversationSearchText(conversation: AgentConversation) {
  return [
    conversation.title,
    ...conversation.messages.map((message) => message.content),
    ...conversation.rounds.map((round) => round.prompt),
  ].join('\n').toLocaleLowerCase()
}

export function buildAgentHistoryItems(conversations: AgentConversation[]): ConversationHistoryItem[] {
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    searchText: getConversationSearchText(conversation),
  }))
}

export function getAgentHistoryDeletePreview(conversation: AgentConversation | null, tasks: TaskRecord[]) {
  const relatedTaskIds = getAgentConversationTaskIds(conversation, tasks)
  const relatedTaskIdSet = new Set(relatedTaskIds)
  const generatedImageCount = new Set(
    tasks
      .filter((task) => relatedTaskIdSet.has(task.id))
      .flatMap((task) => task.outputImages || []),
  ).size
  return { relatedTaskIds, generatedImageCount }
}

export function selectAgentHistoryConversation(
  id: string,
  editingId: string | null,
  actions: {
    setAppMode: (mode: 'agent') => void
    setActiveConversationId: (id: string) => void
    onClose: () => void
  },
) {
  if (editingId) return false
  actions.setAppMode('agent')
  actions.setActiveConversationId(id)
  actions.onClose()
  return true
}

export function renameAgentHistoryConversation(
  id: string,
  title: string,
  renameDisabledIds: Record<string, boolean>,
  actions: {
    renameConversation: (id: string, title: string) => void
    setEditingId: (id: string | null) => void
  },
) {
  if (!renameDisabledIds[id]) actions.renameConversation(id, title)
  actions.setEditingId(null)
}

export function buildAgentHistoryDeleteDialog(
  id: string,
  conversations: AgentConversation[],
  tasks: TaskRecord[],
  actions: {
    removeTasks: (ids: string[]) => Promise<void>
    deleteConversation: (id: string) => void
    onClose: () => void
  },
) {
  const targetConversation = conversations.find((item) => item.id === id) ?? null
  const { relatedTaskIds, generatedImageCount } = getAgentHistoryDeletePreview(targetConversation, tasks)
  return {
    title: '删除对话',
    message: '确定要删除这个 Agent 对话吗？',
    checkbox: relatedTaskIds.length > 0
      ? {
          label: generatedImageCount > 0
            ? `同时删除对话中生成的图片（${generatedImageCount} 张）和关联任务`
            : `同时删除对话关联任务（${relatedTaskIds.length} 个）`,
          tone: 'danger' as const,
        }
      : undefined,
    action: async (deleteGeneratedImages = false) => {
      if (deleteGeneratedImages && relatedTaskIds.length > 0) await actions.removeTasks(relatedTaskIds)
      actions.deleteConversation(id)
      if (conversations.length <= 1) actions.onClose()
    },
  }
}

type HistoryModalProps = {
  onClose: () => void
  ignoreOutsideClickRef?: React.RefObject<HTMLElement | null>
}

export default function HistoryModal({ onClose, ignoreOutsideClickRef }: HistoryModalProps) {
  const conversations = useStore((state) => state.agentConversations)
  const activeConversationId = useStore((state) => state.activeAgentConversationId)
  const setActiveConversationId = useStore((state) => state.setActiveAgentConversationId)
  const renameConversation = useStore((state) => state.renameAgentConversation)
  const deleteConversation = useStore((state) => state.deleteAgentConversation)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const confirmDialogOpen = useStore((state) => Boolean(state.confirmDialog))
  const setAppMode = useStore((state) => state.setAppMode)
  const tasks = useStore((state) => state.tasks)
  const agentGeneratingTitleIds = useStore((state) => state.agentGeneratingTitleIds)
  const editingId = useStore((state) => state.agentEditingConversationId)
  const setEditingId = useStore((state) => state.setAgentEditingConversationId)

  const handleSelect = (id: string) => {
    selectAgentHistoryConversation(id, editingId, { setAppMode, setActiveConversationId, onClose })
  }

  const handleRename = (id: string, title: string) => {
    renameAgentHistoryConversation(id, title, agentGeneratingTitleIds, { renameConversation, setEditingId })
  }

  const handleDelete = (id: string) => {
    setConfirmDialog(buildAgentHistoryDeleteDialog(id, conversations, tasks, {
      removeTasks: removeMultipleTasks,
      deleteConversation,
      onClose,
    }))
  }

  return (
    <ConversationHistoryPopover
      items={buildAgentHistoryItems(conversations)}
      activeId={activeConversationId}
      editingId={editingId}
      renameDisabledIds={agentGeneratingTitleIds}
      confirmDialogOpen={confirmDialogOpen}
      ignoreOutsideClickRef={ignoreOutsideClickRef}
      onEditingIdChange={setEditingId}
      onSelect={handleSelect}
      onRename={handleRename}
      onDelete={handleDelete}
      onClose={onClose}
    />
  )
}
