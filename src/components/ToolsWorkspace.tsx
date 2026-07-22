import { useEffect, useRef, useState } from 'react'
import type {
  AfternoonTeaOrderResult,
  AfternoonTeaConversation,
  AfternoonTeaPosterBatchItem,
  ApiProfile,
  AppSettings,
  InputImage,
  TaskParams,
  TaskRecord,
} from '../types'
import { createInputImageFromFile, deleteImageIfUnreferenced, editOutputs, ensureImageCached, removeTask, reuseConfig, submitAfternoonTeaPosterTask, useStore } from '../store'
import { getActiveApiProfile, normalizeSettings, validateApiProfile } from '../lib/apiProfiles'
import {
  AfternoonTeaBatchCoordinator,
  retryAfternoonTeaPosterItem,
  runAfternoonTeaPosterBatch,
} from '../lib/afternoonTeaBatch'
import { parseAfternoonTeaOrderResult } from '../lib/afternoonTeaOrder'
import { buildAfternoonTeaPosterPrompts } from '../lib/afternoonTeaPosterPromptBuilder'
import { analyzeDish } from '../lib/dishAnalysisApi'
import { storeImage } from '../lib/db'
import {
  buildDishAnalysisSystemPrompt,
  buildDishAnalysisUserPrompt,
  DEFAULT_DISH_SYSTEM_PROMPT,
  DEFAULT_DISH_TITLE_COUNT,
  DEFAULT_DISH_USER_PROMPT,
  DISH_SYSTEM_PROMPT_STORAGE_KEY,
} from '../lib/dishAnalysisPrompts'
import { normalizeParamsForSettings } from '../lib/paramCompatibility'
import { getAfternoonTeaConversationSearchText, reconcileAfternoonTeaConversationBatch } from '../lib/afternoonTeaConversations'
import { useDocumentImagePaste } from '../lib/useDocumentImagePaste'
import { ChevronDownIcon, CloseIcon, EditIcon, ImportIcon, MessageCircleIcon } from './icons'
import { ConversationHistoryPopover, type ConversationHistoryItem } from './ConversationHistoryPopover'
import {
  AfternoonTeaPosterStep,
  getAfternoonTeaPosterErrorMessage,
  type AfternoonTeaPosterViewItem,
} from './tools/AfternoonTeaPosterStep'

export const MAX_DISH_IMAGE_BYTES = 20 * 1024 * 1024

export function normalizeDishTitleCount(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_DISH_TITLE_COUNT
  return Math.max(1, Math.min(10, Math.floor(value)))
}

export function validateDishImageFile(file: Pick<File, 'type' | 'size'>) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > MAX_DISH_IMAGE_BYTES) throw new Error('餐品图片不能超过 20 MiB')
}

export function validateDishAnalysisInput(userPrompt: string) {
  if (!userPrompt.trim()) throw new Error('请填写下午茶订单')
}

export function getDishAnalysisProfile(settings: AppSettings): ApiProfile | null {
  const profile = getActiveApiProfile(settings)
  if (profile.provider !== 'openai' || !profile.understandingModel?.trim()) return null
  return profile
}

export type DishAnalysisStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

export type DishAnalysisRun = {
  conversationId: string
  status: Exclude<DishAnalysisStatus, 'idle'>
  startedAt: number
  finishedAt: number | null
}

export function deriveDishAnalysisViewState(
  conversation: Pick<AfternoonTeaConversation, 'id' | 'orderResult' | 'analysisElapsed'> | null,
  run: DishAnalysisRun | null,
  now = Date.now(),
): { status: DishAnalysisStatus; elapsed: number | null } {
  if (conversation && run?.conversationId === conversation.id) {
    return {
      status: run.status,
      elapsed: Math.max(0, (run.finishedAt ?? now) - run.startedAt),
    }
  }
  return {
    status: conversation?.orderResult ? 'success' : 'idle',
    elapsed: conversation?.analysisElapsed ?? null,
  }
}

export function resolveAfternoonTeaEntryConversationId(
  activeConversation: Pick<AfternoonTeaConversation, 'id' | 'batchFinishedAt'> | null,
  createConversation: (options?: { force?: boolean }) => string,
) {
  if (activeConversation && activeConversation.batchFinishedAt == null) return activeConversation.id
  return createConversation({ force: true })
}

export function deriveAfternoonTeaPosterViewItems(
  items: AfternoonTeaPosterBatchItem[],
  tasks: TaskRecord[],
): AfternoonTeaPosterViewItem[] {
  return items.map((item) => {
    if (item.setupError) return { ...item, status: 'error', error: item.setupError }
    if (!item.taskId) return { ...item, status: 'queued' }
    const task = tasks.find((candidate) => candidate.id === item.taskId)
    if (!task) return { ...item, status: 'error', error: '任务记录不存在，请重试此项' }
    return {
      ...item,
      status: task.status,
      task,
      error: task.status === 'error' ? getAfternoonTeaPosterErrorMessage(new Error(task.error || '图片生成失败')) : undefined,
    }
  })
}

export function getAfternoonTeaConversationRestoreState(
  conversation: AfternoonTeaConversation,
  fallbackSystemPrompt = DEFAULT_DISH_SYSTEM_PROMPT,
) {
  return {
    userPrompt: conversation.orderText,
    systemPrompt: conversation.systemPrompt || fallbackSystemPrompt,
    titleCount: normalizeDishTitleCount(conversation.titleCount),
    imageName: conversation.sourceImageName,
    orderResult: conversation.orderResult,
    analysisSystemPromptSnapshot: conversation.analysisSystemPromptSnapshot,
    analysisUserPromptSnapshot: conversation.analysisUserPromptSnapshot,
    step: conversation.batchStartedAt != null ? 'poster' as const : 'order' as const,
  }
}

export function getAfternoonTeaHistoryDeletePreview(conversation: AfternoonTeaConversation, tasks: TaskRecord[]) {
  const relatedTaskIds = new Set(conversation.posterItems.flatMap((item) => item.taskId ? [item.taskId] : []))
  for (const task of tasks) {
    if (task.afternoonTeaBatchId === conversation.id) relatedTaskIds.add(task.id)
  }
  const relatedTaskIdList = [...relatedTaskIds]
  const relatedTaskIdSet = new Set(relatedTaskIdList)
  const generatedImageCount = new Set(
    tasks
      .filter((task) => relatedTaskIdSet.has(task.id))
      .flatMap((task) => task.outputImages || []),
  ).size
  return {
    relatedTaskIds: relatedTaskIdList,
    generatedImageCount,
    hasSourceImage: Boolean(conversation.sourceImageId),
  }
}

export function isAfternoonTeaConversationBusy(conversation: AfternoonTeaConversation, tasks: TaskRecord[]) {
  return (conversation.batchStartedAt != null && conversation.batchFinishedAt == null)
    || tasks.some((task) => task.afternoonTeaBatchId === conversation.id && task.status === 'running')
}

type AfternoonTeaConversationPatch = Partial<Omit<AfternoonTeaConversation, 'id' | 'createdAt' | 'updatedAt'>>
type AfternoonTeaConversationState = {
  afternoonTeaConversations: AfternoonTeaConversation[]
  updateAfternoonTeaConversation: (id: string, patch: AfternoonTeaConversationPatch) => void
}

export function createAfternoonTeaBatchCallbacks(
  getState: () => AfternoonTeaConversationState,
  now = Date.now,
) {
  return {
    onTaskCreated: (batchId: string, itemId: string, taskId: string) => {
      const state = getState()
      const conversation = state.afternoonTeaConversations.find((item) => item.id === batchId)
      if (!conversation) return
      state.updateAfternoonTeaConversation(batchId, {
        posterItems: conversation.posterItems.map((item) => item.id === itemId
          ? { id: item.id, title: item.title, prompt: item.prompt, taskId }
          : item),
      })
    },
    onItemSetupError: (batchId: string, itemId: string, setupError: unknown) => {
      const state = getState()
      const conversation = state.afternoonTeaConversations.find((item) => item.id === batchId)
      if (!conversation) return
      const message = getAfternoonTeaPosterErrorMessage(setupError)
      state.updateAfternoonTeaConversation(batchId, {
        posterItems: conversation.posterItems.map((item) => item.id === itemId
          ? { id: item.id, title: item.title, prompt: item.prompt, taskId: item.taskId, setupError: message }
          : item),
      })
    },
    onBatchFinished: (batchId: string) => {
      const state = getState()
      const conversation = state.afternoonTeaConversations.find((item) => item.id === batchId)
      if (!conversation || conversation.batchFinishedAt != null) return
      state.updateAfternoonTeaConversation(batchId, { batchFinishedAt: now() })
    },
  }
}

export async function startAfternoonTeaConversationBatch(
  conversation: AfternoonTeaConversation,
  updateConversation: (id: string, patch: AfternoonTeaConversationPatch) => void,
  runBatch: () => Promise<void>,
  now = Date.now,
) {
  if (conversation.batchStartedAt != null) return false
  updateConversation(conversation.id, { batchStartedAt: now() })
  await runBatch()
  return true
}

export type AfternoonTeaBatchRuntime = {
  batchId: string
  items: AfternoonTeaPosterBatchItem[]
  settingsSnapshot: AppSettings
  paramsSnapshot: TaskParams
  inputImage: InputImage
  coordinator: AfternoonTeaBatchCoordinator
}

export function disposeAfternoonTeaBatchRuntime(
  runtime: Pick<AfternoonTeaBatchRuntime, 'batchId' | 'coordinator'>,
  getState: () => AfternoonTeaConversationState & { tasks: TaskRecord[] },
  now = Date.now,
) {
  runtime.coordinator.dispose()
  const state = getState()
  const conversation = state.afternoonTeaConversations.find((item) => item.id === runtime.batchId)
  if (!conversation) return
  const reconciled = reconcileAfternoonTeaConversationBatch(conversation, state.tasks, now(), {
    interruptUnclaimed: true,
  })
  if (reconciled === conversation) return
  state.updateAfternoonTeaConversation(conversation.id, {
    posterItems: reconciled.posterItems,
    batchFinishedAt: reconciled.batchFinishedAt,
  })
}

export function createReloadAfternoonTeaBatchRuntime(
  conversation: AfternoonTeaConversation,
  sourceDataUrl: string,
  settings: AppSettings,
  params: TaskParams,
  tasks: TaskRecord[] = [],
): AfternoonTeaBatchRuntime | null {
  if (!conversation.sourceImageId || !sourceDataUrl || conversation.batchStartedAt == null || conversation.batchFinishedAt == null) return null
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  if (conversation.posterItems.some((item) => item.taskId && taskById.get(item.taskId)?.status === 'running')) return null
  const settingsSnapshot = normalizeSettings(settings)
  const activeProfile = getActiveApiProfile(settingsSnapshot)
  if (activeProfile.provider !== 'openai' || validateApiProfile(activeProfile)) return null
  const coordinator = new AfternoonTeaBatchCoordinator()
  coordinator.finish(conversation.id, coordinator.start(conversation.id))
  return {
    batchId: conversation.id,
    items: conversation.posterItems,
    settingsSnapshot,
    paramsSnapshot: normalizeParamsForSettings({ ...params }, settingsSnapshot, { hasInputImages: true }),
    inputImage: { id: conversation.sourceImageId, dataUrl: sourceDataUrl },
    coordinator,
  }
}

export function isAfternoonTeaRetryDisabled(
  busy: boolean,
  conversation: AfternoonTeaConversation | null,
  settings: AppSettings,
  tasks: TaskRecord[] = [],
) {
  if (busy || !conversation?.sourceImageId || conversation.batchStartedAt == null || conversation.batchFinishedAt == null) return true
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  if (conversation.posterItems.some((item) => item.taskId && taskById.get(item.taskId)?.status === 'running')) return true
  const profile = getActiveApiProfile(normalizeSettings(settings))
  return profile.provider !== 'openai' || Boolean(validateApiProfile(profile))
}

type AfternoonTeaTaskActionDeps = {
  setDetailTaskId: (id: string) => void
  setConfirmDialog: (dialog: { title: string; message: string; action: () => void }) => void
  setAppMode: (mode: 'gallery') => void
  reuseConfig: (task: TaskRecord) => Promise<void>
  editOutputs: (task: TaskRecord) => Promise<void>
  removeTask: (task: TaskRecord) => Promise<void>
}

export function createAfternoonTeaTaskActions(deps: AfternoonTeaTaskActionDeps) {
  return {
    onClick: (task: TaskRecord) => deps.setDetailTaskId(task.id),
    onDelete: (task: TaskRecord) => deps.setConfirmDialog({
      title: '删除任务',
      message: '确定要删除这个任务吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => void deps.removeTask(task),
    }),
    onReuse: (task: TaskRecord) => {
      deps.setAppMode('gallery')
      void deps.reuseConfig(task)
    },
    onEditOutputs: (task: TaskRecord) => {
      deps.setAppMode('gallery')
      void deps.editOutputs(task)
    },
  }
}

export class DishAnalysisCoordinator {
  private imageSelection = 0
  private request: AbortController | null = null
  private restoreSkipConversationId: string | null = null

  beginImageSelection() {
    this.imageSelection += 1
    return this.imageSelection
  }

  invalidateImageSelection() {
    this.imageSelection += 1
  }

  isCurrentImageSelection(selection: number) {
    return selection === this.imageSelection
  }

  beginRequest() {
    if (this.request) return null
    this.request = new AbortController()
    return this.request
  }

  isCurrentRequest(request: AbortController) {
    return request === this.request
  }

  finishRequest(request: AbortController) {
    if (this.request === request) this.request = null
  }

  cancelRequest() {
    this.request?.abort()
    this.request = null
  }

  skipNextRestore(conversationId: string) {
    this.restoreSkipConversationId = conversationId
  }

  consumeRestoreSkip(conversationId: string) {
    const shouldSkip = this.restoreSkipConversationId === conversationId
    this.restoreSkipConversationId = null
    return shouldSkip
  }

  dispose() {
    this.invalidateImageSelection()
    this.request?.abort()
    this.request = null
    this.restoreSkipConversationId = null
  }
}

type DishAnalysisFormViewProps = {
  configured: boolean
  imageDataUrl: string
  imageLoading?: boolean
  imageMissing?: boolean
  userPrompt: string
  systemPrompt: string
  titleCount: number
  orderResult: AfternoonTeaOrderResult | null
  error: string
  loading: boolean
  analysisStatus: DishAnalysisStatus
  analysisElapsed: number | null
  locked: boolean
  onImageChange: (file: File | null) => void
  onRemoveImage: () => void
  onUserPromptChange: (value: string) => void
  onSystemPromptChange: (value: string) => void
  onTitleCountChange: (value: number) => void
  onResetSystemPrompt: () => void
  onSubmit: () => void
  onCancel: () => void
  onClear: () => void
  onGoPoster: () => void
}

type ToolsWorkflowStepsProps = {
  step: 'order' | 'poster'
  posterEnabled: boolean
  busy: boolean
  onStepChange: (step: 'order' | 'poster') => void
}

export function ToolsWorkflowSteps(props: ToolsWorkflowStepsProps) {
  return (
    <div className="border-b border-gray-200 py-2.5 dark:border-white/[0.08] sm:px-6 sm:py-0">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100/80 p-1 dark:bg-white/[0.04] sm:flex sm:rounded-none sm:bg-transparent sm:p-0 dark:sm:bg-transparent" role="group" aria-label="下午茶海报步骤">
        <button type="button" aria-pressed={props.step === 'order'} onClick={() => props.onStepChange('order')} disabled={props.busy} className={`flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-md border-b-2 border-transparent px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:rounded-none sm:py-3 ${props.step === 'order' ? 'bg-white text-blue-700 shadow-sm dark:bg-white/[0.1] dark:text-blue-300 sm:border-blue-500 sm:bg-transparent sm:shadow-none dark:sm:bg-transparent' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
          订单解析
        </button>
        <button type="button" aria-pressed={props.step === 'poster'} onClick={() => props.onStepChange('poster')} disabled={!props.posterEnabled || props.busy} className={`flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-md border-b-2 border-transparent px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:rounded-none sm:py-3 ${props.step === 'poster' ? 'bg-white text-blue-700 shadow-sm dark:bg-white/[0.1] dark:text-blue-300 sm:border-blue-500 sm:bg-transparent sm:shadow-none dark:sm:bg-transparent' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
          批量海报
        </button>
      </div>
    </div>
  )
}

export function DishAnalysisFormView(props: DishAnalysisFormViewProps) {
  const disabled = Boolean(props.loading || props.locked || props.imageLoading)
  const analysisStatusLabel = props.analysisStatus === 'running'
    ? '解析中'
    : props.analysisStatus === 'success'
      ? '解析成功'
      : props.analysisStatus === 'error'
        ? '解析失败'
        : props.analysisStatus === 'cancelled'
          ? '已取消'
          : '等待解析'
  const analysisStatusColor = props.analysisStatus === 'running'
    ? 'bg-blue-500'
    : props.analysisStatus === 'success'
      ? 'bg-emerald-500'
      : props.analysisStatus === 'error'
        ? 'bg-red-500'
        : props.analysisStatus === 'cancelled'
          ? 'bg-amber-500'
          : 'bg-gray-400'
  const elapsedSeconds = props.analysisElapsed == null
    ? null
    : Math.floor(Math.max(0, props.analysisElapsed) / 1_000)
  const elapsedText = elapsedSeconds == null
    ? '--:--'
    : `${Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`
  const submitLabel = props.analysisStatus === 'error'
    ? '重试解析'
    : props.analysisStatus === 'success' || props.analysisStatus === 'cancelled'
      ? '重新解析'
      : '开始解析'

  return (
    <div className="min-w-0 flex-1 px-0 py-4 sm:px-6 sm:py-7">
      <div className={`${props.configured ? 'hidden sm:flex' : 'flex'} mb-4 flex-wrap items-start justify-between gap-3 sm:mb-6`}>
        <div className="hidden sm:block">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">餐品解析</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">使用当前 API 配置中的语义理解/多模态模型</p>
        </div>
        {!props.configured && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            请先在 API 配置中选择 OpenAI 配置，并填写语义理解/多模态模型 ID
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <section className="min-w-0 space-y-5" aria-label="餐品解析输入">
          <div className="grid items-start gap-4 md:grid-cols-[192px_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="mb-1.5 text-sm text-gray-600 dark:text-gray-300">餐品图片</div>
              {props.imageDataUrl ? (
                <div className="relative w-full max-w-48 overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <img src={props.imageDataUrl} alt="待解析餐品" className="aspect-[4/3] w-full object-contain" />
                  <button type="button" onClick={props.onRemoveImage} disabled={disabled} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/55 text-white shadow-sm transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="移除餐品图片">
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex aspect-[4/3] w-full max-w-48 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50/60 text-center transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-white/[0.12] dark:bg-white/[0.02] dark:hover:border-blue-500/40 dark:hover:bg-blue-500/[0.04]">
                  <ImportIcon className="mb-3 h-7 w-7 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{props.imageLoading ? '正在读取图片...' : props.imageMissing ? '原图不可用，重新上传' : '上传餐品图片'}</span>
                  <span className="mt-1 text-xs text-gray-400">或按 Ctrl/⌘ + V 粘贴</span>
                  <span className="mt-1 text-xs text-gray-400">单张图片，最大 20 MiB</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={disabled}
                    onChange={(event) => {
                      props.onImageChange(event.target.files?.[0] ?? null)
                      event.target.value = ''
                    }}
                    className="sr-only"
                  />
                </label>
              )}
            </div>

            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">下午茶订单</span>
              <textarea
                value={props.userPrompt}
                onChange={(event) => props.onUserPromptChange(event.target.value)}
                disabled={disabled}
                rows={5}
                className="min-h-36 w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:border-blue-500/50"
              />
            </label>
          </div>

          <details className="group border-y border-gray-200 py-3 dark:border-white/[0.08]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-gray-600 marker:hidden dark:text-gray-300">
              <span>系统提示词 <span className="text-xs text-gray-400 dark:text-gray-500">高级设置</span></span>
              <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-end">
                <button type="button" onClick={props.onResetSystemPrompt} disabled={disabled} className="shrink-0 text-xs text-gray-500 transition hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:text-blue-300">
                  恢复默认
                </button>
              </div>
              <textarea
                value={props.systemPrompt}
                onChange={(event) => props.onSystemPromptChange(event.target.value)}
                disabled={disabled}
                rows={10}
                className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-800 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:border-blue-500/50"
              />
            </div>
          </details>

          {props.error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              <div>{props.error}</div>
              {props.analysisStatus === 'error' && (
                <div className="mt-1 text-xs text-red-500 dark:text-red-300">请检查订单内容后点击“重试解析”</div>
              )}
            </div>
          )}

          <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-end gap-3 sm:flex sm:flex-wrap sm:justify-between" aria-label="解析操作">
            <label className="block w-full sm:w-32">
              <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">生成数量</span>
              <input
                type="number"
                min="1"
                max="10"
                value={props.titleCount}
                disabled={disabled}
                onChange={(event) => props.onTitleCountChange(normalizeDishTitleCount(Number(event.target.value)))}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-blue-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:border-blue-500/50"
              />
            </label>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              {props.loading ? (
                <button type="button" onClick={props.onCancel} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08] sm:px-4">
                  取消解析
                </button>
              ) : (
                <button type="button" onClick={props.onSubmit} disabled={!props.configured || props.locked || !props.userPrompt.trim()} className="whitespace-nowrap rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4">
                  {submitLabel}
                </button>
              )}
              {(props.orderResult || props.error) && !props.loading && (
                <button type="button" onClick={props.onClear} disabled={props.locked} className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200">
                  清空
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="min-h-0 min-w-0 rounded-md border border-gray-200 bg-gray-50/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.02] sm:p-4 lg:min-h-[360px]" aria-label="解析结果">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">解析结果</div>
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
              <span className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${analysisStatusColor}`} />
                {analysisStatusLabel}
              </span>
              <span className="tabular-nums">耗时 {elapsedText}</span>
            </div>
          </div>
          {props.loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400 lg:h-48">正在解析...</div>
          ) : props.orderResult ? (
            <div className="space-y-5">
              <div>
                <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">海报标题</div>
                <div className="flex flex-wrap gap-2">
                  {props.orderResult.titles.map((title) => (
                    <span key={title} className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">{title}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">订单商品</div>
                <div className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white dark:divide-white/[0.08] dark:border-white/[0.08] dark:bg-white/[0.03]">
                  {props.orderResult.items.map((item, idx) => (
                    <div key={`${item.displayName}-${idx}`} className="px-3 py-2.5">
                      <div className="break-words text-sm font-medium text-gray-800 dark:text-gray-100">{item.displayName}</div>
                      {item.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {item.tags.map((tag) => <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{tag}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <button type="button" onClick={props.onGoPoster} disabled={props.locked} className="w-full whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                进入批量海报
              </button>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400 lg:h-48">解析结果将显示在这里</div>
          )}
        </section>
      </div>
    </div>
  )
}

export default function ToolsWorkspace() {
  const settings = useStore((state) => state.settings)
  const params = useStore((state) => state.params)
  const tasks = useStore((state) => state.tasks)
  const afternoonTeaConversations = useStore((state) => state.afternoonTeaConversations)
  const afternoonTeaConversationsLoaded = useStore((state) => state.afternoonTeaConversationsLoaded)
  const activeAfternoonTeaConversationId = useStore((state) => state.activeAfternoonTeaConversationId)
  const afternoonTeaEditingConversationId = useStore((state) => state.afternoonTeaEditingConversationId)
  const createAfternoonTeaConversation = useStore((state) => state.createAfternoonTeaConversation)
  const setDefaultAfternoonTeaTitleCount = useStore((state) => state.setDefaultAfternoonTeaTitleCount)
  const setActiveAfternoonTeaConversationId = useStore((state) => state.setActiveAfternoonTeaConversationId)
  const updateAfternoonTeaConversation = useStore((state) => state.updateAfternoonTeaConversation)
  const renameAfternoonTeaConversation = useStore((state) => state.renameAfternoonTeaConversation)
  const deleteAfternoonTeaConversation = useStore((state) => state.deleteAfternoonTeaConversation)
  const setAfternoonTeaEditingConversationId = useStore((state) => state.setAfternoonTeaEditingConversationId)
  const setDetailTaskId = useStore((state) => state.setDetailTaskId)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const showToast = useStore((state) => state.showToast)
  const confirmDialog = useStore((state) => state.confirmDialog)
  const setAppMode = useStore((state) => state.setAppMode)
  const afternoonTeaBatchOperationId = useStore((state) => state.afternoonTeaBatchOperationId)
  const tryBeginAfternoonTeaBatchOperation = useStore((state) => state.tryBeginAfternoonTeaBatchOperation)
  const finishAfternoonTeaBatchOperation = useStore((state) => state.finishAfternoonTeaBatchOperation)
  const analysisProfile = getDishAnalysisProfile(settings)
  const activeConversation = afternoonTeaConversations.find((conversation) => conversation.id === activeAfternoonTeaConversationId) ?? null
  const coordinatorRef = useRef(new DishAnalysisCoordinator())
  const mountedRef = useRef(true)
  const defaultSystemPromptRef = useRef(DEFAULT_DISH_SYSTEM_PROMPT)
  const cachedSourceImageRef = useRef<{ dataUrl: string; id: string } | null>(null)
  const batchRuntimeRef = useRef<AfternoonTeaBatchRuntime | null>(null)
  const batchRuntimesRef = useRef(new Map<string, AfternoonTeaBatchRuntime>())
  const batchStartingConversationIdsRef = useRef(new Set<string>())
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const initialConversationResolvedRef = useRef(false)
  const analysisPromptSnapshotsRef = useRef<{ system: string | null; user: string | null }>({ system: null, user: null })
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [imageName, setImageName] = useState('')
  const [imageLoading, setImageLoading] = useState(false)
  const [imageMissing, setImageMissing] = useState(false)
  const [userPrompt, setUserPrompt] = useState(DEFAULT_DISH_USER_PROMPT)
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_DISH_SYSTEM_PROMPT)
  const [titleCount, setTitleCount] = useState(DEFAULT_DISH_TITLE_COUNT)
  const [step, setStep] = useState<'order' | 'poster'>('order')
  const [batchRunning, setBatchRunning] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [batchPageError, setBatchPageError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [analysisRun, setAnalysisRun] = useState<DishAnalysisRun | null>(null)
  const [analysisNow, setAnalysisNow] = useState(Date.now())
  const [historyOpen, setHistoryOpen] = useState(false)
  const batchItems = activeConversation?.posterItems ?? []
  const viewItems = deriveAfternoonTeaPosterViewItems(batchItems, tasks)
  const batchBusy = Boolean(afternoonTeaBatchOperationId) || batchRunning || retrying
  const analysisViewState = deriveDishAnalysisViewState(activeConversation, analysisRun, analysisNow)
  const retryDisabled = !imageDataUrl || isAfternoonTeaRetryDisabled(batchBusy, activeConversation, settings, tasks)
  const batchCallbacks = createAfternoonTeaBatchCallbacks(useStore.getState)
  const historyItems: ConversationHistoryItem[] = afternoonTeaConversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    searchText: getAfternoonTeaConversationSearchText(conversation),
  }))
  const taskActions = createAfternoonTeaTaskActions({
    setDetailTaskId,
    setConfirmDialog,
    setAppMode,
    reuseConfig,
    editOutputs,
    removeTask,
  })

  const restoreConversation = async (conversationId: string) => {
    coordinatorRef.current.cancelRequest()
    const selection = coordinatorRef.current.beginImageSelection()
    const state = useStore.getState()
    const conversation = state.afternoonTeaConversations.find((item) => item.id === conversationId)
    if (!conversation || state.activeAfternoonTeaConversationId !== conversationId) return

    const restore = getAfternoonTeaConversationRestoreState(conversation, defaultSystemPromptRef.current)
    setUserPrompt(restore.userPrompt)
    setSystemPrompt(restore.systemPrompt)
    setTitleCount(restore.titleCount)
    setImageName(restore.imageName)
    setStep(restore.step)
    setError('')
    setBatchPageError('')
    setLoading(false)
    setAnalysisRun(null)
    analysisPromptSnapshotsRef.current = {
      system: restore.analysisSystemPromptSnapshot,
      user: restore.analysisUserPromptSnapshot,
    }
    batchRuntimeRef.current = batchRuntimesRef.current.get(conversation.id) ?? null
    cachedSourceImageRef.current = null
    setImageDataUrl('')
    setImageMissing(false)
    setImageLoading(Boolean(conversation.sourceImageId))

    if (!conversation.sourceImageId) return
    let sourceImage: string | undefined
    try {
      sourceImage = await ensureImageCached(conversation.sourceImageId)
    } catch {
      sourceImage = undefined
    }
    const latestState = useStore.getState()
    if (
      !coordinatorRef.current.isCurrentImageSelection(selection)
      || latestState.activeAfternoonTeaConversationId !== conversation.id
    ) return

    setImageLoading(false)
    if (!sourceImage) {
      setImageMissing(true)
      return
    }
    cachedSourceImageRef.current = { id: conversation.sourceImageId, dataUrl: sourceImage }
    setImageDataUrl(sourceImage)
  }

  const createEditableConversationFrom = (conversation: AfternoonTeaConversation) => {
    const conversationId = createAfternoonTeaConversation()
    updateAfternoonTeaConversation(conversationId, {
      sourceImageId: conversation.sourceImageId,
      sourceImageName: conversation.sourceImageName,
      orderText: conversation.orderText,
      titleCount: conversation.titleCount,
      systemPrompt: conversation.systemPrompt,
      analysisSystemPromptSnapshot: null,
      analysisUserPromptSnapshot: null,
      analysisElapsed: null,
      orderResult: null,
      posterItems: [],
      batchStartedAt: null,
      batchFinishedAt: null,
    })
    setStep('order')
    coordinatorRef.current.skipNextRestore(conversationId)
    return useStore.getState().afternoonTeaConversations.find((item) => item.id === conversationId) ?? null
  }

  const initializeNewConversationPrompt = (conversationId: string) => {
    const conversation = useStore.getState().afternoonTeaConversations.find((item) => item.id === conversationId)
    if (
      conversation
      && conversation.systemPrompt === DEFAULT_DISH_SYSTEM_PROMPT
      && defaultSystemPromptRef.current !== DEFAULT_DISH_SYSTEM_PROMPT
    ) updateAfternoonTeaConversation(conversationId, { systemPrompt: defaultSystemPromptRef.current })
  }

  const ensureEditableConversation = () => {
    const state = useStore.getState()
    const conversation = state.afternoonTeaConversations.find((item) => item.id === state.activeAfternoonTeaConversationId) ?? null
    if (!conversation) {
      const conversationId = state.createAfternoonTeaConversation()
      initializeNewConversationPrompt(conversationId)
      void restoreConversation(conversationId)
      return useStore.getState().afternoonTeaConversations.find((item) => item.id === conversationId) ?? null
    }
    if (conversation.batchStartedAt != null) return createEditableConversationFrom(conversation)
    return conversation
  }

  const resetParsedResult = (conversationId: string) => {
    const conversation = useStore.getState().afternoonTeaConversations.find((item) => item.id === conversationId)
    if (!conversation || conversation.batchStartedAt != null) return false
    if (batchRuntimeRef.current?.batchId === conversationId) batchRuntimeRef.current = null
    batchRuntimesRef.current.delete(conversationId)
    analysisPromptSnapshotsRef.current = { system: null, user: null }
    updateAfternoonTeaConversation(conversationId, {
      analysisSystemPromptSnapshot: null,
      analysisUserPromptSnapshot: null,
      analysisElapsed: null,
      orderResult: null,
      posterItems: [],
      batchStartedAt: null,
      batchFinishedAt: null,
    })
    setAnalysisRun((run) => run?.conversationId === conversationId ? null : run)
    setBatchPageError('')
    setStep('order')
    return true
  }

  useEffect(() => {
    try {
      const savedPrompt = window.localStorage.getItem(DISH_SYSTEM_PROMPT_STORAGE_KEY)
      if (savedPrompt !== null) {
        defaultSystemPromptRef.current = savedPrompt
        if (!useStore.getState().afternoonTeaConversations.find((item) => item.id === useStore.getState().activeAfternoonTeaConversationId)?.systemPrompt) {
          setSystemPrompt(savedPrompt)
        }
      }
    } catch {
      // localStorage 不可用时继续使用源码默认提示词。
    }
  }, [])

  useEffect(() => {
    if (!afternoonTeaConversationsLoaded) return

    if (!initialConversationResolvedRef.current) {
      initialConversationResolvedRef.current = true
      const state = useStore.getState()
      const activeConversation = state.afternoonTeaConversations.find((item) => item.id === state.activeAfternoonTeaConversationId) ?? null
      const conversationId = resolveAfternoonTeaEntryConversationId(activeConversation, state.createAfternoonTeaConversation)
      if (conversationId !== activeConversation?.id) initializeNewConversationPrompt(conversationId)
      void restoreConversation(conversationId)
      return
    }

    if (activeAfternoonTeaConversationId) {
      if (coordinatorRef.current.consumeRestoreSkip(activeAfternoonTeaConversationId)) return
      void restoreConversation(activeAfternoonTeaConversationId)
      return
    }

    const conversationId = createAfternoonTeaConversation()
    initializeNewConversationPrompt(conversationId)
    void restoreConversation(conversationId)
  }, [afternoonTeaConversationsLoaded, activeAfternoonTeaConversationId])

  useEffect(() => {
    if (analysisRun?.status !== 'running') return
    setAnalysisNow(Date.now())
    const timer = window.setInterval(() => setAnalysisNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [analysisRun?.conversationId, analysisRun?.startedAt, analysisRun?.status])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      coordinatorRef.current.dispose()
      const runtimes = new Set(batchRuntimesRef.current.values())
      for (const runtime of runtimes) disposeAfternoonTeaBatchRuntime(runtime, useStore.getState)
      batchRuntimesRef.current.clear()
      batchRuntimeRef.current = null
    }
  }, [])

  const updateSystemPrompt = (value: string) => {
    coordinatorRef.current.cancelRequest()
    coordinatorRef.current.invalidateImageSelection()
    const conversation = ensureEditableConversation()
    defaultSystemPromptRef.current = value
    setSystemPrompt(value)
    if (conversation) {
      resetParsedResult(conversation.id)
      updateAfternoonTeaConversation(conversation.id, { systemPrompt: value })
    }
    try {
      window.localStorage.setItem(DISH_SYSTEM_PROMPT_STORAGE_KEY, value)
    } catch {
      // localStorage 不可用时只保留当前页面的编辑结果。
    }
  }

  const resetSystemPrompt = () => {
    coordinatorRef.current.cancelRequest()
    coordinatorRef.current.invalidateImageSelection()
    const conversation = ensureEditableConversation()
    setSystemPrompt(DEFAULT_DISH_SYSTEM_PROMPT)
    defaultSystemPromptRef.current = DEFAULT_DISH_SYSTEM_PROMPT
    if (conversation) {
      resetParsedResult(conversation.id)
      updateAfternoonTeaConversation(conversation.id, { systemPrompt: DEFAULT_DISH_SYSTEM_PROMPT })
    }
    try {
      window.localStorage.removeItem(DISH_SYSTEM_PROMPT_STORAGE_KEY)
    } catch {
      // localStorage 不可用时仍恢复当前页面的源码默认值。
    }
  }

  const handleImageChange = async (file: File | null) => {
    if (!file) return
    try {
      validateDishImageFile(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取餐品图片失败')
      return
    }
    coordinatorRef.current.cancelRequest()
    const conversation = ensureEditableConversation()
    if (!conversation) return
    const conversationId = conversation.id
    const selection = coordinatorRef.current.beginImageSelection()
    setError('')
    setImageLoading(true)
    setImageMissing(false)
    try {
      const image = await createInputImageFromFile(file)
      if (!image) throw new Error('请选择图片文件')
      const state = useStore.getState()
      if (
        !coordinatorRef.current.isCurrentImageSelection(selection)
        || state.activeAfternoonTeaConversationId !== conversationId
      ) {
        void deleteImageIfUnreferenced(image.id)
        return
      }

      const latestConversation = state.afternoonTeaConversations.find((item) => item.id === conversationId)
      if (!latestConversation) return
      const sameImage = latestConversation.sourceImageId === image.id
      cachedSourceImageRef.current = image
      setImageDataUrl(image.dataUrl)
      setImageName(file.name)
      setImageMissing(false)
      if (sameImage) {
        if (latestConversation.sourceImageName !== file.name) {
          updateAfternoonTeaConversation(conversationId, { sourceImageName: file.name })
        }
        return
      }

      const previousSourceImageId = latestConversation.sourceImageId
      resetParsedResult(conversationId)
      updateAfternoonTeaConversation(conversationId, {
        sourceImageId: image.id,
        sourceImageName: file.name,
      })
      if (previousSourceImageId && previousSourceImageId !== image.id) {
        void deleteImageIfUnreferenced(previousSourceImageId)
      }
    } catch (err) {
      if (!coordinatorRef.current.isCurrentImageSelection(selection)) return
      setError(err instanceof Error ? err.message : '读取餐品图片失败')
    } finally {
      if (
        coordinatorRef.current.isCurrentImageSelection(selection)
        && useStore.getState().activeAfternoonTeaConversationId === conversationId
      ) setImageLoading(false)
    }
  }

  const removeImage = () => {
    coordinatorRef.current.cancelRequest()
    const conversation = ensureEditableConversation()
    coordinatorRef.current.invalidateImageSelection()
    cachedSourceImageRef.current = null
    setImageDataUrl('')
    setImageName('')
    setImageLoading(false)
    setImageMissing(false)
    if (!conversation) return
    const previousSourceImageId = conversation.sourceImageId
    resetParsedResult(conversation.id)
    updateAfternoonTeaConversation(conversation.id, {
      sourceImageId: null,
      sourceImageName: '',
    })
    if (previousSourceImageId) void deleteImageIfUnreferenced(previousSourceImageId)
  }

  const submit = async () => {
    if (batchBusy) return
    const conversation = ensureEditableConversation()
    if (!conversation) return
    const conversationId = conversation.id
    const request = coordinatorRef.current.beginRequest()
    if (!request) return
    const analysisRevision = coordinatorRef.current.beginImageSelection()
    resetParsedResult(conversationId)
    setLoading(true)
    setError('')
    const analysisStartedAt = Date.now()
    setAnalysisNow(analysisStartedAt)
    setAnalysisRun({
      conversationId,
      status: 'running',
      startedAt: analysisStartedAt,
      finishedAt: null,
    })
    const requestImageDataUrl = imageDataUrl
    const requestImageName = imageName
    const requestUserPrompt = userPrompt
    const requestSystemPrompt = systemPrompt
    const requestTitleCount = titleCount
    const analysisSystemPromptSnapshot = buildDishAnalysisSystemPrompt(requestSystemPrompt, requestTitleCount)
    const analysisUserPromptSnapshot = buildDishAnalysisUserPrompt(requestUserPrompt, requestTitleCount)
    const isCurrentAnalysisRequest = () => {
      const activeAfternoonTeaConversationId = useStore.getState().activeAfternoonTeaConversationId
      return coordinatorRef.current.isCurrentRequest(request)
        && !request.signal.aborted
        && coordinatorRef.current.isCurrentImageSelection(analysisRevision)
        && activeAfternoonTeaConversationId === conversationId
    }

    try {
      validateDishAnalysisInput(requestUserPrompt)
      if (!analysisProfile) throw new Error('请先在 API 配置中选择 OpenAI 配置，并填写语义理解/多模态模型 ID')
      const raw = await analyzeDish({
        profile: analysisProfile,
        userPrompt: analysisUserPromptSnapshot,
        systemPrompt: analysisSystemPromptSnapshot,
        signal: request.signal,
      })
      const result = parseAfternoonTeaOrderResult(raw, requestTitleCount)
      if (!isCurrentAnalysisRequest()) return
      const itemSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const posterItems = buildAfternoonTeaPosterPrompts(result).map((item, idx) => ({
        id: `${itemSeed}-${idx}`,
        title: item.title,
        prompt: item.prompt,
      }))
      const latestConversation = useStore.getState().afternoonTeaConversations.find((item) => item.id === conversationId)
      if (!latestConversation) return
      const cachedSource = cachedSourceImageRef.current?.dataUrl === requestImageDataUrl
        ? cachedSourceImageRef.current
        : null
      let createdSourceImageId: string | null = null
      const sourceImageId = requestImageDataUrl
        ? cachedSource?.id
          ?? latestConversation.sourceImageId
          ?? (createdSourceImageId = await storeImage(requestImageDataUrl, 'upload'))
        : latestConversation.sourceImageId
      if (!isCurrentAnalysisRequest()) {
        if (createdSourceImageId) void deleteImageIfUnreferenced(createdSourceImageId)
        return
      }
      if (sourceImageId && requestImageDataUrl) {
        cachedSourceImageRef.current = { dataUrl: requestImageDataUrl, id: sourceImageId }
      }
      analysisPromptSnapshotsRef.current = {
        system: analysisSystemPromptSnapshot,
        user: analysisUserPromptSnapshot,
      }
      setBatchPageError('')
      batchRuntimeRef.current = null
      batchRuntimesRef.current.delete(conversationId)
      const analysisFinishedAt = Date.now()
      updateAfternoonTeaConversation(conversationId, {
        title: latestConversation.title === '新下午茶会话' ? result.titles[0] : latestConversation.title,
        sourceImageId,
        sourceImageName: requestImageName || latestConversation.sourceImageName,
        orderText: requestUserPrompt,
        titleCount: requestTitleCount,
        systemPrompt: requestSystemPrompt,
        analysisSystemPromptSnapshot,
        analysisUserPromptSnapshot,
        analysisElapsed: Math.max(0, analysisFinishedAt - analysisStartedAt),
        orderResult: result,
        posterItems,
        batchStartedAt: null,
        batchFinishedAt: null,
      })
      setAnalysisRun({
        conversationId,
        status: 'success',
        startedAt: analysisStartedAt,
        finishedAt: analysisFinishedAt,
      })
    } catch (err) {
      if (isCurrentAnalysisRequest()) {
        const analysisFinishedAt = Date.now()
        setError(err instanceof Error ? err.message : '餐品解析失败')
        setAnalysisRun({
          conversationId,
          status: 'error',
          startedAt: analysisStartedAt,
          finishedAt: analysisFinishedAt,
        })
      }
    } finally {
      if (isCurrentAnalysisRequest()) setLoading(false)
      coordinatorRef.current.finishRequest(request)
    }
  }

  const clear = () => {
    removeImage()
    setError('')
  }

  const cancelAnalysis = () => {
    const conversationId = useStore.getState().activeAfternoonTeaConversationId
    const analysisFinishedAt = Date.now()
    setAnalysisRun((run) => run?.conversationId === conversationId && run.status === 'running'
      ? { ...run, status: 'cancelled', finishedAt: analysisFinishedAt }
      : run)
    coordinatorRef.current.cancelRequest()
    coordinatorRef.current.invalidateImageSelection()
    setLoading(false)
  }

  const startBatch = async () => {
    const conversationId = activeConversation?.id
    if (!conversationId || !activeConversation.sourceImageId || !activeConversation.orderResult || batchItems.length === 0 || batchBusy || activeConversation.batchStartedAt != null) return
    const operationId = `afternoon-tea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if (!tryBeginAfternoonTeaBatchOperation(operationId)) return
    const batchCoordinator = new AfternoonTeaBatchCoordinator()
    batchStartingConversationIdsRef.current.add(conversationId)
    setBatchRunning(true)
    setBatchPageError('')
    try {
      const settingsSnapshot = normalizeSettings(settings)
      const activeProfile = getActiveApiProfile(settingsSnapshot)
      if (activeProfile.provider !== 'openai') throw new Error('下午茶海报目前仅支持 OpenAI 图片模型配置')
      const profileError = validateApiProfile(activeProfile)
      if (profileError) throw new Error(`请先完善图片 API 配置：${profileError}`)
      const paramsSnapshot = normalizeParamsForSettings({ ...params }, settingsSnapshot, { hasInputImages: true })
      const cachedSource = cachedSourceImageRef.current?.id === activeConversation.sourceImageId
        ? cachedSourceImageRef.current
        : null
      const sourceImage = cachedSource?.dataUrl ?? await ensureImageCached(activeConversation.sourceImageId)
      if (!sourceImage) throw new Error('原图已不可用，请重新上传餐品图片')
      if (!mountedRef.current) return
      const currentState = useStore.getState()
      const currentConversation = currentState.afternoonTeaConversations.find((item) => item.id === conversationId)
      if (
        currentState.activeAfternoonTeaConversationId !== conversationId
        || !currentConversation
        || currentConversation.batchStartedAt != null
        || currentConversation.sourceImageId !== activeConversation.sourceImageId
      ) return
      const imageId = currentConversation.sourceImageId
      if (!imageId) throw new Error('原图已不可用，请重新上传餐品图片')
      cachedSourceImageRef.current = { dataUrl: sourceImage, id: imageId }
      const inputImage: InputImage = { id: imageId, dataUrl: sourceImage }
      const originalItems = currentConversation.posterItems.map((item) => ({ id: item.id, title: item.title, prompt: item.prompt }))
      const runtime = { batchId: conversationId, items: originalItems, settingsSnapshot, paramsSnapshot, inputImage, coordinator: batchCoordinator }
      batchRuntimeRef.current = runtime
      batchRuntimesRef.current.set(conversationId, runtime)

      const started = await startAfternoonTeaConversationBatch(currentConversation, updateAfternoonTeaConversation, () => (
        runAfternoonTeaPosterBatch({
          coordinator: batchCoordinator,
          batchId: conversationId,
          items: originalItems,
          settingsSnapshot,
          paramsSnapshot,
          inputImage,
          submit: submitAfternoonTeaPosterTask,
          ...batchCallbacks,
        })
      ))
      if (!started) {
        batchRuntimesRef.current.delete(conversationId)
        if (batchRuntimeRef.current?.batchId === conversationId) batchRuntimeRef.current = null
      }
    } catch (err) {
      if (mountedRef.current && useStore.getState().activeAfternoonTeaConversationId === conversationId) {
        setBatchPageError(getAfternoonTeaPosterErrorMessage(err))
      }
    } finally {
      batchStartingConversationIdsRef.current.delete(conversationId)
      batchRuntimesRef.current.delete(conversationId)
      if (batchRuntimeRef.current?.batchId === conversationId) batchRuntimeRef.current = null
      finishAfternoonTeaBatchOperation(operationId)
      if (mountedRef.current) setBatchRunning(false)
    }
  }

  const retryItem = async (itemId: string) => {
    if (batchBusy || !activeConversation || isAfternoonTeaRetryDisabled(false, activeConversation, settings, tasks)) return
    if (!imageDataUrl) {
      setBatchPageError('原图已不可用，请重新上传餐品图片')
      return
    }
    const item = activeConversation.posterItems.find((candidate) => candidate.id === itemId)
    if (!item) return
    const retryConversationId = activeConversation.id
    batchStartingConversationIdsRef.current.add(retryConversationId)
    const operationId = `${retryConversationId}-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if (!tryBeginAfternoonTeaBatchOperation(operationId)) {
      batchStartingConversationIdsRef.current.delete(retryConversationId)
      return
    }
    setRetrying(true)
    setBatchPageError('')
    try {
      let runtime = batchRuntimeRef.current
      if (runtime && runtime.batchId !== activeConversation.id) runtime = null
      runtime ??= batchRuntimesRef.current.get(activeConversation.id) ?? null
      if (!runtime) {
        if (!activeConversation.sourceImageId) return
        const sourceImage = await ensureImageCached(activeConversation.sourceImageId)
        if (!sourceImage || !mountedRef.current) return
        const latestState = useStore.getState()
        if (latestState.activeAfternoonTeaConversationId !== activeConversation.id) return
        const latestConversation = latestState.afternoonTeaConversations.find((conversation) => conversation.id === activeConversation.id)
        if (!latestConversation) return
        runtime = createReloadAfternoonTeaBatchRuntime(latestConversation, sourceImage, settings, params, latestState.tasks)
        if (!runtime) return
        batchRuntimeRef.current = runtime
        batchRuntimesRef.current.set(runtime.batchId, runtime)
      }
      if (!runtime.coordinator.isTerminal(runtime.batchId)) return
      await retryAfternoonTeaPosterItem({
        coordinator: runtime.coordinator,
        batchId: runtime.batchId,
        item,
        settingsSnapshot: runtime.settingsSnapshot,
        paramsSnapshot: runtime.paramsSnapshot,
        inputImage: runtime.inputImage,
        submit: submitAfternoonTeaPosterTask,
        onTaskCreated: batchCallbacks.onTaskCreated,
        onItemSetupError: batchCallbacks.onItemSetupError,
      })
    } catch (err) {
      if (mountedRef.current && useStore.getState().activeAfternoonTeaConversationId === retryConversationId) {
        setBatchPageError(getAfternoonTeaPosterErrorMessage(err))
      }
    } finally {
      const runtime = batchRuntimesRef.current.get(retryConversationId)
      if (runtime) batchRuntimesRef.current.delete(retryConversationId)
      if (batchRuntimeRef.current?.batchId === retryConversationId) batchRuntimeRef.current = null
      finishAfternoonTeaBatchOperation(operationId)
      if (mountedRef.current) setRetrying(false)
      batchStartingConversationIdsRef.current.delete(retryConversationId)
    }
  }

  const updateUserPrompt = (value: string) => {
    coordinatorRef.current.cancelRequest()
    coordinatorRef.current.invalidateImageSelection()
    const conversation = ensureEditableConversation()
    setUserPrompt(value)
    if (conversation) {
      resetParsedResult(conversation.id)
      updateAfternoonTeaConversation(conversation.id, { orderText: value })
    }
  }

  const updateTitleCount = (value: number) => {
    coordinatorRef.current.cancelRequest()
    coordinatorRef.current.invalidateImageSelection()
    const normalizedCount = normalizeDishTitleCount(value)
    setDefaultAfternoonTeaTitleCount(normalizedCount)
    const conversation = ensureEditableConversation()
    setTitleCount(normalizedCount)
    if (conversation) {
      resetParsedResult(conversation.id)
      updateAfternoonTeaConversation(conversation.id, { titleCount: normalizedCount })
    }
  }

  const reparse = () => {
    coordinatorRef.current.cancelRequest()
    coordinatorRef.current.invalidateImageSelection()
    const conversation = useStore.getState().afternoonTeaConversations.find((item) => item.id === useStore.getState().activeAfternoonTeaConversationId)
    if (conversation?.batchStartedAt != null) createEditableConversationFrom(conversation)
    else if (conversation) resetParsedResult(conversation.id)
    setError('')
  }

  const handleNewConversation = () => {
    const conversationId = createAfternoonTeaConversation()
    initializeNewConversationPrompt(conversationId)
    setHistoryOpen(false)
    void restoreConversation(conversationId)
  }

  const handleSelectConversation = (conversationId: string) => {
    setActiveAfternoonTeaConversationId(conversationId)
    setHistoryOpen(false)
    void restoreConversation(conversationId)
  }

  const handleDeleteConversation = (conversationId: string) => {
    const conversation = afternoonTeaConversations.find((item) => item.id === conversationId)
    if (!conversation) return
    if (isAfternoonTeaConversationBusy(conversation, tasks) || batchStartingConversationIdsRef.current.has(conversationId)) {
      setConfirmDialog({
        title: '批次正在生成',
        message: '当前会话仍有图片任务在处理，完成后再删除会话。',
        confirmText: '知道了',
        showCancel: false,
        action: () => {},
      })
      return
    }
    const preview = getAfternoonTeaHistoryDeletePreview(conversation, tasks)
    const relatedLabel = preview.generatedImageCount > 0
      ? `同时删除关联任务和生成图片（${preview.generatedImageCount} 张）`
      : `同时删除关联任务（${preview.relatedTaskIds.length} 个）`
    setConfirmDialog({
      title: '删除餐品解析会话',
      message: '默认只删除会话记录。关联任务和生成图片会继续保留。',
      checkbox: preview.relatedTaskIds.length > 0
        ? { label: relatedLabel, tone: 'danger' }
        : undefined,
      action: (deleteRelated = false) => {
        void deleteAfternoonTeaConversation(conversationId, deleteRelated).catch((err) => {
          const message = err instanceof Error ? err.message.trim() : ''
          showToast(message ? `删除会话失败：${message}` : '删除会话失败，请稍后重试', 'error')
        })
        setHistoryOpen(false)
      },
    })
  }

  useDocumentImagePaste((files) => {
    const file = files[0]
    if (!file) return false
    void handleImageChange(file)
    return true
  }, imageLoading || loading || batchBusy || Boolean(confirmDialog))

  return (
    <main className="safe-area-x mx-auto max-w-7xl pb-12">
      <div className="grid min-h-[calc(100dvh-8rem)] sm:min-h-[calc(100vh-8rem)] sm:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="relative flex h-14 items-center border-b border-gray-200 dark:border-white/[0.08] sm:block sm:h-auto sm:border-b-0 sm:border-r sm:py-6" aria-label="工具列表">
          <div className="hidden text-xs font-medium text-gray-400 sm:block sm:px-3">工具</div>
          <div className="relative flex min-w-0 flex-1 items-center sm:mx-3 sm:mt-2 sm:block">
            <div aria-current="page" className="min-w-0 flex-1 truncate py-2 text-left text-base font-semibold text-gray-900 dark:text-gray-100 sm:w-full sm:whitespace-nowrap sm:border-l-2 sm:border-blue-500 sm:bg-blue-50/70 sm:px-3 sm:pr-[68px] sm:text-sm sm:font-medium sm:text-blue-700 sm:dark:bg-blue-500/10 sm:dark:text-blue-300">
              餐品解析
            </div>
            <div className="relative z-10 ml-auto flex shrink-0 items-center gap-0 sm:absolute sm:right-1 sm:top-1/2 sm:ml-0 sm:-translate-y-1/2">
              <button
                ref={historyButtonRef}
                type="button"
                onClick={() => setHistoryOpen((value) => !value)}
                className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 sm:h-9 sm:w-8"
                title="餐品解析历史"
                aria-label="餐品解析历史"
                aria-expanded={historyOpen}
              >
                <MessageCircleIcon className="h-5 w-5 sm:h-4 sm:w-4" />
              </button>
              <button
                type="button"
                onClick={handleNewConversation}
                className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 sm:h-9 sm:w-8"
                title="新建餐品解析会话"
                aria-label="新建餐品解析会话"
              >
                <EditIcon className="h-5 w-5 sm:h-4 sm:w-4" />
              </button>
              {historyOpen && (
                <ConversationHistoryPopover
                  items={historyItems}
                  activeId={activeAfternoonTeaConversationId}
                  editingId={afternoonTeaEditingConversationId}
                  confirmDialogOpen={Boolean(confirmDialog)}
                  ignoreOutsideClickRef={historyButtonRef}
                  searchPlaceholder="搜索餐品解析会话..."
                  emptyText="没有找到匹配的餐品解析会话"
                  onEditingIdChange={setAfternoonTeaEditingConversationId}
                  onSelect={handleSelectConversation}
                  onRename={renameAfternoonTeaConversation}
                  onDelete={handleDeleteConversation}
                  onClose={() => setHistoryOpen(false)}
                />
              )}
            </div>
          </div>
        </nav>
        <div className="min-w-0">
          <ToolsWorkflowSteps
            step={step}
            posterEnabled={Boolean(activeConversation?.orderResult)}
            busy={batchBusy || loading}
            onStepChange={setStep}
          />
          {step === 'order' ? (
            <DishAnalysisFormView
              configured={Boolean(analysisProfile)}
              imageDataUrl={imageDataUrl}
              imageLoading={imageLoading}
              imageMissing={imageMissing}
              userPrompt={userPrompt}
              systemPrompt={systemPrompt}
              titleCount={titleCount}
              orderResult={activeConversation?.orderResult ?? null}
              error={error}
              loading={loading}
              analysisStatus={analysisViewState.status}
              analysisElapsed={analysisViewState.elapsed}
              locked={batchBusy}
              onImageChange={(file) => void handleImageChange(file)}
              onRemoveImage={removeImage}
              onUserPromptChange={updateUserPrompt}
              onSystemPromptChange={updateSystemPrompt}
              onTitleCountChange={updateTitleCount}
              onResetSystemPrompt={resetSystemPrompt}
              onSubmit={() => void submit()}
              onCancel={cancelAnalysis}
              onClear={clear}
              onGoPoster={() => setStep('poster')}
            />
          ) : (
            <AfternoonTeaPosterStep
              sourceImageSrc={imageDataUrl}
              items={viewItems}
              busy={batchBusy}
              batchStartedAt={activeConversation?.batchStartedAt ?? null}
              batchFinishedAt={activeConversation?.batchFinishedAt ?? null}
              retryDisabled={retryDisabled}
              pageError={batchPageError}
              onStart={() => void startBatch()}
              onBack={() => setStep('order')}
              onClear={clear}
              onReparse={reparse}
              onRetry={(itemId) => void retryItem(itemId)}
              onTaskClick={taskActions.onClick}
              onTaskDelete={taskActions.onDelete}
              onTaskReuse={taskActions.onReuse}
              onTaskEditOutputs={taskActions.onEditOutputs}
            />
          )}
        </div>
      </div>
    </main>
  )
}
