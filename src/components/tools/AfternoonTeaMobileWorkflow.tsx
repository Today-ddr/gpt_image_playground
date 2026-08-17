import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type TouchEvent } from 'react'
import type { AfternoonTeaOrderResult, AfternoonTeaTitleRegion, TaskRecord } from '../../types'
import { prepareImageFile, savePreparedImageFile } from '../../lib/downloadImages'
import { ensureImageCached, ensureImageThumbnailCached, subscribeImageThumbnail } from '../../store'
import {
  CameraIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  EditIcon,
  ImportIcon,
  MinusIcon,
  PasteIcon,
  PlusIcon,
} from '../icons'
import TaskCard from '../TaskCard'
import { WandAnimation } from '../wand-animation-react'
import type { AfternoonTeaPosterViewItem } from './AfternoonTeaPosterStep'
import { AfternoonTeaItemPlacement } from './AfternoonTeaTitlePlacement'
import { resolveAfternoonTeaPlacementSelection } from '../../lib/afternoonTeaTitlePlacement'
import { resolveAfternoonTeaTitleCandidates } from '../../lib/dishAnalysisPrompts'

export type MobileAfternoonTeaPhase = 'input' | 'analyzing' | 'review' | 'generating' | 'results'

type MobileAfternoonTeaPhaseState = {
  orderResult: AfternoonTeaOrderResult | null
  analysisStatus: 'idle' | 'running' | 'success' | 'error' | 'cancelled'
  batchStartedAt: number | null
  batchFinishedAt: number | null
}

export type MobileAfternoonTeaCandidate = {
  /** 选择/列表唯一 id；多中转站时为 task.id，单任务时为 poster item id */
  itemId: string
  /** 原始海报条目 id，用于重试 */
  sourceItemId: string
  title: string
  imageId: string
  task: TaskRecord
}

/** 将海报条目展开为每个中转站/任务一个结果槽（与画廊小卡片一一对应） */
export function expandAfternoonTeaMobileResultSlots(items: AfternoonTeaPosterViewItem[]) {
  return items.flatMap((item) => {
    if (item.slots && item.slots.length) {
      return item.slots.map((slot, slotIndex) => ({
        key: slot.taskId || `${item.id}-slot-${slotIndex}`,
        itemId: item.id,
        title: item.title,
        status: slot.status,
        task: slot.task,
        error: slot.error || item.error,
        profileName: slot.profileName || slot.task?.apiProfileName,
      }))
    }
    return [{
      key: item.id,
      itemId: item.id,
      title: item.title,
      status: item.status,
      task: item.task,
      error: item.error,
      profileName: item.task?.apiProfileName,
    }]
  })
}

export type AfternoonTeaMobileResultSlot = ReturnType<typeof expandAfternoonTeaMobileResultSlots>[number]

export function getAfternoonTeaResultSlotNumber(slots: Array<Pick<AfternoonTeaMobileResultSlot, 'key'>>, slotKey: string) {
  const index = slots.findIndex((slot) => slot.key === slotKey)
  return index >= 0 ? index + 1 : 0
}

function getAfternoonTeaCompletionTimestamp(slot: Pick<AfternoonTeaMobileResultSlot, 'task'>) {
  const finishedAt = slot.task?.finishedAt
  if (typeof finishedAt === 'number' && Number.isFinite(finishedAt)) return finishedAt
  const createdAt = slot.task?.createdAt
  if (typeof createdAt === 'number' && Number.isFinite(createdAt)) return createdAt
  return Number.POSITIVE_INFINITY
}

/** 只给已出图的槽位按完成时间编号；生成中不编号 */
export function getAfternoonTeaCompletionOrderNumbers(
  slots: Array<Pick<AfternoonTeaMobileResultSlot, 'key' | 'status' | 'task'>>,
) {
  const completed = slots.filter((slot) => slot.status === 'done' && Boolean(slot.task?.outputImages[0]))
  const ordered = [...completed].sort((left, right) => {
    const timeDelta = getAfternoonTeaCompletionTimestamp(left) - getAfternoonTeaCompletionTimestamp(right)
    if (timeDelta !== 0) return timeDelta
    return left.key.localeCompare(right.key)
  })
  return new Map(ordered.map((slot, index) => [slot.key, index + 1]))
}

export function getAfternoonTeaSlotSignature(slot: Pick<AfternoonTeaMobileResultSlot, 'key' | 'status' | 'task'>) {
  const outputImageId = slot.status === 'done' ? (slot.task?.outputImages[0] ?? '') : ''
  return `${slot.key}\u0001${slot.status}\u0001${outputImageId}`
}

export function collectFreshAfternoonTeaSlotKeys(
  previousSignatures: ReadonlyMap<string, string>,
  nextSlots: Array<Pick<AfternoonTeaMobileResultSlot, 'key' | 'status' | 'task'>>,
) {
  return nextSlots.flatMap((slot) => {
    if (slot.status !== 'done' || !slot.task?.outputImages[0]) return []
    const previousSignature = previousSignatures.get(slot.key)
    if (!previousSignature) return []
    const [, previousStatus = '', previousImageId = ''] = previousSignature.split('\u0001')
    if (previousStatus !== 'done') return [slot.key]
    return previousImageId && previousImageId !== slot.task.outputImages[0] ? [slot.key] : []
  })
}

export function dismissAfternoonTeaFreshSlotKeys(freshSlotKeys: string[], slotKey: string) {
  return freshSlotKeys.filter((key) => key !== slotKey)
}

export function findAfternoonTeaResultSlotForCandidate(
  slots: AfternoonTeaMobileResultSlot[],
  candidate: Pick<MobileAfternoonTeaCandidate, 'itemId' | 'sourceItemId' | 'task'>,
) {
  return slots.find((slot) => slot.task?.id === candidate.task.id)
    ?? slots.find((slot) => slot.key === candidate.itemId || slot.itemId === candidate.sourceItemId)
    ?? null
}

export function applyAfternoonTeaTitleCandidate(titles: string[], focusedIndex: number, candidate: string) {
  const normalized = candidate.trim()
  if (!normalized) return null
  if (!Number.isInteger(focusedIndex) || focusedIndex < 0 || focusedIndex >= titles.length) return null
  if (titles[focusedIndex] === normalized) return titles
  if (titles.includes(normalized)) return null
  return titles.map((title, index) => index === focusedIndex ? normalized : title)
}

export function advanceAfternoonTeaTitleFocusIndex(currentIndex: number, titleCount: number) {
  if (!Number.isInteger(titleCount) || titleCount <= 0) return 0
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return 0
  return (currentIndex + 1) % titleCount
}

type AfternoonTeaMobileWorkflowProps = {
  configured: boolean
  imageDataUrl: string
  imageLoading: boolean
  imageMissing: boolean
  userPrompt: string
  systemPrompt: string
  titleCount: number
  orderResult: AfternoonTeaOrderResult | null
  itemTitleRegions: AfternoonTeaTitleRegion[]
  items: AfternoonTeaPosterViewItem[]
  error: string
  pageError: string
  analysisStatus: MobileAfternoonTeaPhaseState['analysisStatus']
  analysisElapsed: number | null
  batchStartedAt: number | null
  batchFinishedAt: number | null
  busy: boolean
  retryDisabled: boolean
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
  onReparse: () => void
  onPosterTitleChange: (index: number, title: string) => void
  onPosterTitlesChange: (titles: string[]) => void
  onItemTitleRegionsChange: (regions: AfternoonTeaTitleRegion[]) => void
  onItemNameChange: (index: number, displayName: string) => void
  onItemTagsChange: (index: number, tags: string[]) => void
  onConfirmAndGenerate: () => void
  onRetry: (itemId: string, taskId?: string) => void
  onTaskClick: (task: TaskRecord) => void
  onTaskDelete?: (task: TaskRecord) => void
  onTaskReuse?: (task: TaskRecord) => void
  onTaskEditOutputs?: (task: TaskRecord) => void
}

export function deriveMobileAfternoonTeaPhase(state: MobileAfternoonTeaPhaseState): MobileAfternoonTeaPhase {
  if (state.batchFinishedAt != null) return 'results'
  if (state.batchStartedAt != null) return 'generating'
  if (state.orderResult) return 'review'
  if (state.analysisStatus === 'running') return 'analyzing'
  return 'input'
}

export function getMobileAfternoonTeaCandidates(items: AfternoonTeaPosterViewItem[]): MobileAfternoonTeaCandidate[] {
  const multiItemIds = new Set(
    items.filter((item) => (item.slots?.length ?? 0) > 1).map((item) => item.id),
  )
  return expandAfternoonTeaMobileResultSlots(items).flatMap((slot) => {
    if (slot.status !== 'done' || !slot.task?.outputImages[0]) return []
    const multiRelay = multiItemIds.has(slot.itemId)
    const profileLabel = slot.profileName?.trim()
    return [{
      itemId: multiRelay ? slot.task.id : slot.itemId,
      sourceItemId: slot.itemId,
      title: multiRelay && profileLabel ? `${slot.title} · ${profileLabel}` : slot.title,
      imageId: slot.task.outputImages[0],
      task: slot.task,
    }]
  })
}

export function sortAfternoonTeaCandidatesByCompletionTime(candidates: MobileAfternoonTeaCandidate[]) {
  return [...candidates].sort((left, right) => {
    const leftTime = left.task.finishedAt ?? left.task.createdAt
    const rightTime = right.task.finishedAt ?? right.task.createdAt
    if (leftTime !== rightTime) return leftTime - rightTime
    return left.itemId.localeCompare(right.itemId)
  })
}

export function resolveMobileAfternoonTeaSelection(candidates: MobileAfternoonTeaCandidate[], currentItemId: string | null) {
  if (currentItemId && candidates.some((candidate) => candidate.itemId === currentItemId)) return currentItemId
  return candidates[0]?.itemId ?? null
}

export function canReadAfternoonTeaClipboard() {
  return typeof globalThis.isSecureContext === 'boolean'
    && globalThis.isSecureContext
    && typeof globalThis.navigator?.clipboard?.readText === 'function'
}

export async function readAfternoonTeaClipboardText(
  currentText: string,
  readText = () => navigator.clipboard.readText(),
) {
  try {
    const text = await readText()
    return { text: text || currentText, error: '' }
  } catch {
    return { text: currentText, error: '无法读取剪贴板，请长按菜单输入框粘贴' }
  }
}

export function createAfternoonTeaClipboardCoordinator() {
  let revision = 0
  return {
    read: async (currentText: string, readText = () => navigator.clipboard.readText()) => {
      const requestRevision = ++revision
      const result = await readAfternoonTeaClipboardText(currentText, readText)
      return requestRevision === revision ? result : null
    },
    invalidate: () => {
      revision += 1
    },
  }
}

function formatElapsed(value: number | null) {
  if (value == null) return '--:--'
  const seconds = Math.floor(Math.max(0, value) / 1_000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function normalizeTags(value: string) {
  return [...new Set(value.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean))]
}


const GENERATE_SPLIT_STORAGE_KEY = 'gpt-image-playground.tools-generate-split-left-percent'
const GENERATE_SPLIT_DEFAULT_LEFT_PERCENT = 52
const GENERATE_SPLIT_MIN_LEFT_PERCENT = 30
const GENERATE_SPLIT_MAX_LEFT_PERCENT = 70
const GENERATE_SPLIT_MIN_RIGHT_PX = 300

export function clampGenerateSplitLeftPercent(value: number) {
  if (!Number.isFinite(value)) return GENERATE_SPLIT_DEFAULT_LEFT_PERCENT
  return Math.min(GENERATE_SPLIT_MAX_LEFT_PERCENT, Math.max(GENERATE_SPLIT_MIN_LEFT_PERCENT, value))
}

export function readGenerateSplitLeftPercent(storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage) {
  if (!storage) return GENERATE_SPLIT_DEFAULT_LEFT_PERCENT
  try {
    const raw = storage.getItem(GENERATE_SPLIT_STORAGE_KEY)
    if (raw == null || raw === '') return GENERATE_SPLIT_DEFAULT_LEFT_PERCENT
    return clampGenerateSplitLeftPercent(Number(raw))
  } catch {
    return GENERATE_SPLIT_DEFAULT_LEFT_PERCENT
  }
}

export function writeGenerateSplitLeftPercent(
  value: number,
  storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
) {
  if (!storage) return
  try {
    storage.setItem(GENERATE_SPLIT_STORAGE_KEY, String(clampGenerateSplitLeftPercent(value)))
  } catch {
    // ignore quota / private mode failures
  }
}

function AfternoonTeaSourceImagePickers(props: {
  disabled: boolean
  onImageChange: (file: File | null) => void
}) {
  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    props.onImageChange(event.target.files?.[0] ?? null)
    event.target.value = ''
  }
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <label className={`flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-medium text-blue-700 has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 ${props.disabled ? 'pointer-events-none opacity-50' : ''}`}>
        <CameraIcon className="h-5 w-5" />
        <span>拍照</span>
        <input type="file" accept="image/*" capture="environment" disabled={props.disabled} onChange={handleImageInputChange} className="sr-only" aria-label="拍照" />
      </label>
      <label className={`flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 ${props.disabled ? 'pointer-events-none opacity-50' : ''}`}>
        <ImportIcon className="h-5 w-5" />
        <span>照片</span>
        <input type="file" accept="image/*" disabled={props.disabled} onChange={handleImageInputChange} className="sr-only" aria-label="选择照片" />
      </label>
    </div>
  )
}

export function AfternoonTeaMobileWorkflow(props: AfternoonTeaMobileWorkflowProps) {
  const phase = deriveMobileAfternoonTeaPhase({
    orderResult: props.orderResult,
    analysisStatus: props.analysisStatus,
    batchStartedAt: props.batchStartedAt,
    batchFinishedAt: props.batchFinishedAt,
  })
  const [posterTitleDrafts, setPosterTitleDrafts] = useState(() => props.orderResult?.titles ?? [])
  const [itemNameDrafts, setItemNameDrafts] = useState(() => props.orderResult?.items.map((item) => item.displayName) ?? [])
  const [itemTagDrafts, setItemTagDrafts] = useState(() => props.orderResult?.items.map((item) => item.tags.join('，')) ?? [])
  const [editingPosterTitle, setEditingPosterTitle] = useState<number | null>(null)
  const [editingItemName, setEditingItemName] = useState<number | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [placementSelectedIndex, setPlacementSelectedIndex] = useState<number | null>(0)
  const [posterTitleFocusIndex, setPosterTitleFocusIndex] = useState(0)
  const [clipboardError, setClipboardError] = useState('')
  const [clipboardAvailable] = useState(canReadAfternoonTeaClipboard)
  const [clipboardCoordinator] = useState(createAfternoonTeaClipboardCoordinator)
  const [now, setNow] = useState(Date.now())
  const reviewRef = useRef<HTMLDivElement>(null)
  const itemTagInputRef = useRef<HTMLInputElement>(null)
  const previousPhaseRef = useRef(phase)
  const touchStartXRef = useRef<number | null>(null)
  const generateSplitContainerRef = useRef<HTMLDivElement>(null)
  const generateSplitDraggingRef = useRef(false)
  const [generateSplitLeftPercent, setGenerateSplitLeftPercent] = useState(GENERATE_SPLIT_DEFAULT_LEFT_PERCENT)
  const [generateSplitDragging, setGenerateSplitDragging] = useState(false)
  const [isDesktopGenerateSplit, setIsDesktopGenerateSplit] = useState(false)
  const titleKey = props.orderResult?.titles.join('\u0001') ?? ''
  const itemNameKey = props.orderResult?.items.map((item) => item.displayName).join('\u0001') ?? ''
  const itemTagKey = props.orderResult?.items.map((item) => item.tags.join('\u0001')).join('\u0002') ?? ''

  useEffect(() => {
    setPosterTitleDrafts(props.orderResult?.titles ?? [])
    setEditingPosterTitle(null)
    setReviewError('')
  }, [titleKey])
  useEffect(() => {
    const nextTitleCount = props.orderResult?.titles.length ?? 0
    setPosterTitleFocusIndex((current) => {
      if (nextTitleCount <= 0) return 0
      return Math.min(current, nextTitleCount - 1)
    })
  }, [props.orderResult?.titles.length])
  useEffect(() => {
    setItemNameDrafts(props.orderResult?.items.map((item) => item.displayName) ?? [])
    setEditingItemName(null)
  }, [itemNameKey])
  useEffect(() => {
    setItemTagDrafts(props.orderResult?.items.map((item) => item.tags.join('，')) ?? [])
  }, [itemTagKey])
  useEffect(() => {
    setPlacementSelectedIndex((current) => resolveAfternoonTeaPlacementSelection(current, props.orderResult?.items.length ?? 0))
  }, [props.orderResult?.items.length])
  useEffect(() => () => clipboardCoordinator.invalidate(), [clipboardCoordinator])
  useEffect(() => {
    if (previousPhaseRef.current === 'analyzing' && phase === 'review') {
      reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    previousPhaseRef.current = phase
  }, [phase])
  useEffect(() => {
    if (props.batchStartedAt == null || props.batchFinishedAt != null) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [props.batchStartedAt, props.batchFinishedAt])

  const candidates = useMemo(() => getMobileAfternoonTeaCandidates(props.items), [props.items])
  const [unavailableImageIds, setUnavailableImageIds] = useState<string[]>([])
  const availableCandidates = useMemo(
    () => sortAfternoonTeaCandidatesByCompletionTime(
      candidates.filter((candidate) => !unavailableImageIds.includes(candidate.imageId)),
    ),
    [candidates, unavailableImageIds],
  )
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => resolveMobileAfternoonTeaSelection(candidates, null))
  const [selectedImageSrc, setSelectedImageSrc] = useState('')
  const [preparedFile, setPreparedFile] = useState<File | null>(null)
  const [preparingFile, setPreparingFile] = useState(candidates.length > 0)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const candidateKey = availableCandidates.map((candidate) => `${candidate.itemId}:${candidate.imageId}`).join('\u0001')

  useEffect(() => {
    setSelectedItemId((current) => resolveMobileAfternoonTeaSelection(availableCandidates, current))
  }, [candidateKey])
  useEffect(() => {
    let active = true
    const unsubscribers = availableCandidates.map((candidate) => subscribeImageThumbnail(candidate.imageId, (thumbnail) => {
      if (!active) return
      setThumbnails((current) => ({ ...current, [candidate.imageId]: thumbnail.dataUrl }))
    }))
    for (const candidate of availableCandidates) {
      void ensureImageThumbnailCached(candidate.imageId).then((thumbnail) => {
        if (!active || !thumbnail) return
        setThumbnails((current) => ({ ...current, [candidate.imageId]: thumbnail.dataUrl }))
      })
    }
    return () => {
      active = false
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [candidateKey])
  useEffect(() => {
    let active = true
    setSelectedImageSrc('')
    setPreparedFile(null)
    setSaveStatus('')
    if (!selectedItemId) {
      setPreparingFile(false)
      return () => { active = false }
    }
    const candidate = availableCandidates.find((item) => item.itemId === selectedItemId)
    if (!candidate) {
      setPreparingFile(false)
      return () => { active = false }
    }
    setPreparingFile(true)
    void ensureImageCached(candidate.imageId).then(async (dataUrl) => {
      if (!dataUrl) throw new Error('图片已不存在')
      if (active) setSelectedImageSrc(dataUrl)
      const file = await prepareImageFile(dataUrl, candidate.title || 'afternoon-tea-poster')
      if (!active) return
      setPreparedFile(file)
      setPreparingFile(false)
    }).catch(() => {
      if (!active) return
      setPreparingFile(false)
      setUnavailableImageIds((current) => current.includes(candidate.imageId) ? current : [...current, candidate.imageId])
    })
    return () => { active = false }
  }, [selectedItemId, candidateKey])

  const resultSlots = useMemo(() => expandAfternoonTeaMobileResultSlots(props.items), [props.items])
  const completionOrderNumbers = useMemo(() => getAfternoonTeaCompletionOrderNumbers(resultSlots), [resultSlots])
  const previousSlotSignaturesRef = useRef(new Map<string, string>())
  const [freshSlotKeys, setFreshSlotKeys] = useState<string[]>([])
  const [latestFreshSlotKey, setLatestFreshSlotKey] = useState<string | null>(null)

  useEffect(() => {
    const nextFreshKeys = collectFreshAfternoonTeaSlotKeys(previousSlotSignaturesRef.current, resultSlots)
    if (nextFreshKeys.length) {
      setFreshSlotKeys((current) => [...new Set([...current, ...nextFreshKeys])])
      setLatestFreshSlotKey(nextFreshKeys[nextFreshKeys.length - 1] ?? null)
    }
    previousSlotSignaturesRef.current = new Map(resultSlots.map((slot) => [slot.key, getAfternoonTeaSlotSignature(slot)]))
  }, [resultSlots])

  const dismissFreshSlot = (slotKey: string) => {
    setFreshSlotKeys((current) => dismissAfternoonTeaFreshSlotKeys(current, slotKey))
    setLatestFreshSlotKey((current) => current === slotKey ? null : current)
  }

  useEffect(() => {
    setGenerateSplitLeftPercent(readGenerateSplitLeftPercent())
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(min-width: 1024px)')
    const sync = () => setIsDesktopGenerateSplit(mediaQuery.matches)
    sync()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync)
      return () => mediaQuery.removeEventListener('change', sync)
    }
    mediaQuery.addListener(sync)
    return () => mediaQuery.removeListener(sync)
  }, [])

  useEffect(() => {
    if (!generateSplitDragging) return
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [generateSplitDragging])

  const updateGenerateSplitFromClientX = useCallback((clientX: number) => {
    const container = generateSplitContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0) return
    const maxLeftByRightMin = ((rect.width - GENERATE_SPLIT_MIN_RIGHT_PX) / rect.width) * 100
    const upper = Math.min(GENERATE_SPLIT_MAX_LEFT_PERCENT, Math.max(GENERATE_SPLIT_MIN_LEFT_PERCENT, maxLeftByRightMin))
    const next = ((clientX - rect.left) / rect.width) * 100
    setGenerateSplitLeftPercent(Math.min(upper, Math.max(GENERATE_SPLIT_MIN_LEFT_PERCENT, next)))
  }, [])

  const handleGenerateSplitPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    generateSplitDraggingRef.current = true
    setGenerateSplitDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    updateGenerateSplitFromClientX(event.clientX)
  }, [updateGenerateSplitFromClientX])

  const handleGenerateSplitPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!generateSplitDraggingRef.current) return
    updateGenerateSplitFromClientX(event.clientX)
  }, [updateGenerateSplitFromClientX])

  const finishGenerateSplitDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!generateSplitDraggingRef.current) return
    generateSplitDraggingRef.current = false
    setGenerateSplitDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // already released
    }
    setGenerateSplitLeftPercent((current) => {
      const next = clampGenerateSplitLeftPercent(current)
      writeGenerateSplitLeftPercent(next)
      return next
    })
  }, [])

  const resetGenerateSplit = useCallback(() => {
    setGenerateSplitLeftPercent(GENERATE_SPLIT_DEFAULT_LEFT_PERCENT)
    writeGenerateSplitLeftPercent(GENERATE_SPLIT_DEFAULT_LEFT_PERCENT)
  }, [])

  const counters = resultSlots.reduce((result, slot) => ({
    ...result,
    [slot.status]: result[slot.status] + 1,
  }), { queued: 0, running: 0, done: 0, error: 0 })
  const batchElapsed = props.batchStartedAt == null
    ? null
    : Math.max(0, (props.batchFinishedAt ?? now) - props.batchStartedAt)
  const currentCandidate = availableCandidates.find((candidate) => candidate.itemId === selectedItemId) ?? null
  const selectedIndex = currentCandidate
    ? availableCandidates.findIndex((candidate) => candidate.itemId === currentCandidate.itemId)
    : -1
  const currentResultSlot = currentCandidate
    ? findAfternoonTeaResultSlotForCandidate(resultSlots, currentCandidate)
    : null
  const currentResultSlotNumber = currentResultSlot
    ? (completionOrderNumbers.get(currentResultSlot.key) ?? 0)
    : 0
  const latestFreshSlotNumber = latestFreshSlotKey
    ? (completionOrderNumbers.get(latestFreshSlotKey) ?? 0)
    : 0
  const imageLocked = props.locked || props.imageLoading
  const locked = imageLocked || props.busy

  const handlePaste = async () => {
    const result = await clipboardCoordinator.read(props.userPrompt)
    if (!result) return
    setClipboardError(result.error)
    if (!result.error && result.text !== props.userPrompt) props.onUserPromptChange(result.text)
  }
  const commitPosterTitle = (index: number) => {
    const current = props.orderResult?.titles[index] ?? ''
    const normalized = (posterTitleDrafts[index] ?? current).trim()
    if (!normalized) {
      setReviewError('海报标题不能为空')
      return false
    }
    if (posterTitleDrafts.some((title, titleIndex) => titleIndex !== index && title.trim() === normalized)) {
      setReviewError('海报标题不能重复')
      return false
    }
    setPosterTitleDrafts((drafts) => drafts.map((title, titleIndex) => titleIndex === index ? normalized : title))
    if (normalized !== current) props.onPosterTitleChange(index, normalized)
    setEditingPosterTitle(null)
    setReviewError('')
    return true
  }
  const commitItem = (index: number) => {
    const current = props.orderResult?.items[index]?.displayName ?? ''
    const normalized = (itemNameDrafts[index] ?? current).trim()
    if (!normalized) {
      setReviewError('餐品名称不能为空')
      return false
    }
    setItemNameDrafts((drafts) => drafts.map((name, itemIndex) => itemIndex === index ? normalized : name))
    if (normalized !== current) props.onItemNameChange(index, normalized)
    const tags = normalizeTags(itemTagDrafts[index] ?? '')
    const currentTags = props.orderResult?.items[index]?.tags ?? []
    if (tags.length !== currentTags.length || tags.some((tag, tagIndex) => tag !== currentTags[tagIndex])) {
      props.onItemTagsChange(index, tags)
    }
    setItemTagDrafts((drafts) => drafts.map((value, itemIndex) => itemIndex === index ? tags.join('，') : value))
    setEditingItemName(null)
    setReviewError('')
    return true
  }
  const commitItemTags = (index: number) => {
    const tags = normalizeTags(itemTagDrafts[index] ?? '')
    const current = props.orderResult?.items[index]?.tags ?? []
    if (tags.length !== current.length || tags.some((tag, tagIndex) => tag !== current[tagIndex])) {
      props.onItemTagsChange(index, tags)
    }
    setItemTagDrafts((drafts) => drafts.map((value, itemIndex) => itemIndex === index ? tags.join('，') : value))
  }
  const handleConfirmAndGenerate = () => {
    if (!props.orderResult) return
    const normalizedTitles = posterTitleDrafts.map((title) => title.trim())
    const emptyTitleIndex = normalizedTitles.findIndex((title) => !title)
    if (emptyTitleIndex >= 0) {
      setEditingPosterTitle(emptyTitleIndex)
      setReviewError('海报标题不能为空')
      return
    }
    const duplicateTitleIndex = normalizedTitles.findIndex((title, index) => normalizedTitles.indexOf(title) !== index)
    if (duplicateTitleIndex >= 0) {
      setEditingPosterTitle(duplicateTitleIndex)
      setReviewError('海报标题不能重复')
      return
    }
    const emptyItemIndex = itemNameDrafts.findIndex((name) => !name.trim())
    if (emptyItemIndex >= 0) {
      setEditingItemName(emptyItemIndex)
      setReviewError('餐品名称不能为空')
      return
    }
    if (normalizedTitles.some((title, index) => title !== props.orderResult?.titles[index])) {
      props.onPosterTitlesChange(normalizedTitles)
    }
    itemNameDrafts.forEach((name, index) => {
      const normalized = name.trim()
      if (normalized !== props.orderResult?.items[index]?.displayName) props.onItemNameChange(index, normalized)
      commitItemTags(index)
    })
    setReviewError('')
    props.onConfirmAndGenerate()
  }

  const handleAfternoonTeaTitleCandidate = (candidate: string) => {
    const currentTitles = props.orderResult?.titles ?? posterTitleDrafts
    const nextTitles = applyAfternoonTeaTitleCandidate(currentTitles, posterTitleFocusIndex, candidate)
    if (!nextTitles || nextTitles === currentTitles) return
    const nextTitle = nextTitles[posterTitleFocusIndex]
    if (!nextTitle) return
    props.onPosterTitleChange(posterTitleFocusIndex, nextTitle)
    setPosterTitleFocusIndex(advanceAfternoonTeaTitleFocusIndex(posterTitleFocusIndex, currentTitles.length))
  }
  const moveSelection = (direction: -1 | 1) => {
    if (selectedIndex < 0 || availableCandidates.length < 2) return
    const nextIndex = (selectedIndex + direction + availableCandidates.length) % availableCandidates.length
    setSelectedItemId(availableCandidates[nextIndex].itemId)
  }
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current
    touchStartXRef.current = null
    if (startX == null) return
    const distance = event.changedTouches[0]?.clientX - startX
    if (Math.abs(distance) < 48) return
    moveSelection(distance > 0 ? -1 : 1)
  }
  const handleSave = async () => {
    if (!preparedFile || saving) return
    setSaving(true)
    setSaveStatus('')
    try {
      const result = await savePreparedImageFile(preparedFile)
      if (result === 'shared') setSaveStatus('系统面板已关闭')
      if (result === 'downloaded') setSaveStatus('已开始下载图片')
    } catch {
      setSaveStatus('无法保存图片，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const stepIndex = phase === 'input' || phase === 'analyzing' ? 0 : phase === 'review' ? 1 : phase === 'generating' ? 2 : 3
  const steps = ['素材', '审查', '生成', '保存']

  return (
    <div className="min-w-0 px-3 py-3 sm:px-6 sm:py-7 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-x-6" data-mobile-afternoon-tea-workflow aria-label="餐品海报工作流">
      <div className="mb-3 sm:mb-4 lg:col-start-1 lg:row-start-1" aria-label="餐品海报进度">
        <span className="sr-only" aria-live="polite">当前步骤：{steps[stepIndex]}，{stepIndex + 1}/4</span>
        <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
          {steps.map((label, index) => (
            <div key={label} className="min-w-0">
              <div className={`h-1 rounded-full ${index <= stepIndex ? 'bg-blue-600' : 'bg-gray-200 dark:bg-white/[0.1]'}`} />
              <div className={`mt-1 text-center text-[11px] ${index === stepIndex ? 'font-medium text-blue-700 dark:text-blue-300' : 'text-gray-400 dark:text-gray-500'}`}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {(phase === 'input' || phase === 'analyzing') && (
        <div className="space-y-3 pb-3 sm:space-y-4 lg:col-span-2 lg:row-start-2 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)] lg:items-start lg:gap-6 lg:space-y-0" aria-label="素材工作区">
          <section aria-label="餐品图片">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">餐品图片</h2>
              {props.imageDataUrl && (
                <button type="button" onClick={props.onRemoveImage} disabled={imageLocked} className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" aria-label="移除餐品图片">
                  <CloseIcon className="h-5 w-5" />
                </button>
              )}
            </div>
            {props.imageDataUrl ? (
              <div className="flex max-h-[30svh] min-h-36 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-white/[0.08] dark:bg-black/20 sm:max-h-[38svh] sm:min-h-44">
                <img src={props.imageDataUrl} alt="待解析餐品" className="max-h-[30svh] w-full object-contain sm:max-h-[38svh]" />
              </div>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50/60 px-4 text-center text-sm text-gray-500 dark:border-white/[0.12] dark:bg-white/[0.02] dark:text-gray-400">
                {props.imageLoading ? '正在读取图片...' : props.imageMissing ? '原图不可用，请重新选择' : '可先解析菜单，稍后再贴图'}
              </div>
            )}
            <AfternoonTeaSourceImagePickers disabled={imageLocked} onImageChange={props.onImageChange} />
          </section>

          <div className="space-y-4">
            <section aria-label="菜单内容">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">菜单内容</h2>
                {clipboardAvailable && (
                  <button type="button" onClick={() => void handlePaste()} disabled={locked} className="flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-blue-300">
                    <PasteIcon className="h-4 w-4" />
                    粘贴
                  </button>
                )}
              </div>
              <textarea value={props.userPrompt} onChange={(event) => {
                clipboardCoordinator.invalidate()
                props.onUserPromptChange(event.target.value)
              }} disabled={locked} rows={7} className="min-h-28 w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-base leading-relaxed text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:ring-blue-500/10 sm:min-h-40" aria-label="菜单输入" />
              {clipboardError && <div role="alert" className="mt-2 text-sm text-amber-700 dark:text-amber-300">{clipboardError}</div>}
            </section>

            <section aria-label="海报数量">
              <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">海报数量</div>
              <div className="grid h-12 grid-cols-[48px_1fr_48px] overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.1] dark:bg-white/[0.03] sm:max-w-56">
                <button type="button" onClick={() => props.onTitleCountChange(Math.max(1, props.titleCount - 1))} disabled={locked || props.titleCount <= 1} className="flex min-h-11 items-center justify-center border-r border-gray-200 text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 disabled:opacity-35 dark:border-white/[0.1] dark:text-gray-200" aria-label="减少海报数量">
                  <MinusIcon className="h-5 w-5" />
                </button>
                <output className="flex min-w-0 items-center justify-center text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100" aria-label={`当前海报数量 ${props.titleCount}`}>{props.titleCount}</output>
                <button type="button" onClick={() => props.onTitleCountChange(Math.min(10, props.titleCount + 1))} disabled={locked || props.titleCount >= 10} className="flex min-h-11 items-center justify-center border-l border-gray-200 text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 disabled:opacity-35 dark:border-white/[0.1] dark:text-gray-200" aria-label="增加海报数量">
                  <PlusIcon className="h-5 w-5" />
                </button>
              </div>
            </section>

            <details className="group border-y border-gray-200 py-2 dark:border-white/[0.08]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-gray-600 marker:hidden dark:text-gray-300">
                <span>高级设置</span>
                <ChevronDownIcon className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="pb-2 pt-2">
                <div className="mb-2 flex items-center justify-between gap-3 text-sm text-gray-500 dark:text-gray-400">
                  <span>系统提示词</span>
                  <button type="button" onClick={props.onResetSystemPrompt} disabled={locked} className="min-h-11 px-2 text-blue-700 disabled:opacity-50 dark:text-blue-300">恢复默认</button>
                </div>
                <textarea value={props.systemPrompt} onChange={(event) => props.onSystemPromptChange(event.target.value)} disabled={locked} rows={8} className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-800 outline-none focus:border-blue-400 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-gray-100" />
              </div>
            </details>

            {props.error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{props.error}</div>}
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
              <span>{phase === 'analyzing' ? '正在解析菜单' : '等待解析'}</span>
              <span className="tabular-nums">耗时 {formatElapsed(props.analysisElapsed)}</span>
            </div>
          </div>
        </div>
      )}

      {phase === 'review' && props.orderResult && (
        <div ref={reviewRef} className="space-y-4 pb-3 scroll-mt-20 sm:space-y-5 lg:col-span-2 lg:row-start-2 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)] lg:items-start lg:gap-6 lg:space-y-0" aria-label="审查工作区">
          <section aria-label="餐品摆放">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">餐品摆放</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{props.orderResult.items.length} 个餐品</span>
                {props.imageDataUrl && (
                  <button type="button" onClick={props.onRemoveImage} disabled={imageLocked} className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" aria-label="移除餐品图片">
                    <CloseIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
            <AfternoonTeaItemPlacement imageSrc={props.imageDataUrl} items={props.orderResult.items} regions={props.itemTitleRegions} locked={locked} selectedIndex={placementSelectedIndex} onSelectedIndexChange={setPlacementSelectedIndex} onChange={props.onItemTitleRegionsChange} />
            {!props.imageDataUrl && (
              <>
                <AfternoonTeaSourceImagePickers disabled={imageLocked} onImageChange={props.onImageChange} />
                <div className="mt-2 text-center text-xs text-gray-400">也可以 Ctrl/⌘ + V 粘贴，单张最大 20 MiB</div>
              </>
            )}
          </section>

          <div className="space-y-5">
            <section aria-label="海报标题">
              <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">海报标题</h2>
              <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">点备选即可替换当前标题，选完自动到下一条</p>
              <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-white/[0.08] dark:border-white/[0.08]">
                {props.orderResult.titles.map((title, index) => (
                  <div key={`${index}-${title}`} role="group" aria-label={`海报标题 ${String(index + 1).padStart(2, '0')}`} className={`flex min-h-16 min-w-0 items-center gap-2 bg-blue-50 px-2 py-2 dark:bg-blue-500/10 ${posterTitleFocusIndex === index ? 'ring-2 ring-inset ring-blue-400 dark:ring-blue-500/60' : ''}`}>
                    <button type="button" onClick={() => setPosterTitleFocusIndex(index)} className="flex h-11 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300" aria-label={`选择海报标题槽 ${index + 1}`} aria-pressed={posterTitleFocusIndex === index}>
                    <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-blue-600 dark:text-blue-300">{String(index + 1).padStart(2, '0')}</span>
                    </button>
                    {editingPosterTitle === index ? (
                      <>
                        <input autoFocus type="text" value={posterTitleDrafts[index] ?? title} maxLength={60} onChange={(event) => setPosterTitleDrafts((drafts) => drafts.map((value, titleIndex) => titleIndex === index ? event.target.value : value))} onBlur={() => commitPosterTitle(index)} onKeyDown={(event) => {
                          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                          event.preventDefault()
                          event.currentTarget.blur()
                        }} className="min-h-11 min-w-0 flex-1 rounded-md border border-blue-300 bg-white px-3 text-base text-gray-900 outline-none ring-2 ring-blue-100 dark:border-blue-500/50 dark:bg-white/[0.05] dark:text-gray-100 dark:ring-blue-500/10" aria-label={`海报标题 ${index + 1}`} />
                        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => commitPosterTitle(index)} className="min-h-11 shrink-0 rounded-md px-2 text-sm font-medium text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300">完成</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => setPosterTitleFocusIndex(index)} className="min-w-0 flex-1 break-words text-left text-base font-semibold text-blue-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-100">{title}</button>
                        <button type="button" onClick={() => { setPosterTitleFocusIndex(index); setEditingPosterTitle(index) }} disabled={locked} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-gray-400" aria-label={`编辑海报标题 ${index + 1}`}>
                          <EditIcon className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3" aria-label="备选标题">
                <div className="mb-1.5 text-xs text-gray-500 dark:text-gray-400">备选标题</div>
                <div className="flex flex-wrap gap-2">
                  {resolveAfternoonTeaTitleCandidates(props.orderResult).map((candidate) => {
                    const selectedTitleIndex = props.orderResult.titles.indexOf(candidate)
                    const isCurrent = selectedTitleIndex === posterTitleFocusIndex
                    const isUsedElsewhere = selectedTitleIndex >= 0 && !isCurrent
                    return (
                      <button
                        key={candidate}
                        type="button"
                        disabled={locked || isUsedElsewhere}
                        aria-pressed={isCurrent}
                        aria-label={`备选标题 ${candidate}`}
                        onClick={() => handleAfternoonTeaTitleCandidate(candidate)}
                        className={`min-h-9 rounded-full px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                          isCurrent
                            ? 'bg-blue-600 text-white'
                            : isUsedElsewhere
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200'
                              : 'border border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:border-blue-400 dark:hover:text-blue-200'
                        }`}
                      >
                        {candidate}
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

          <section aria-label="餐品与标签">
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">餐品与标签</h2>
            <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-white/[0.08] dark:border-white/[0.08]">
              {props.orderResult.items.map((item, index) => (
                <div key={`${index}-${item.displayName}`} className={`min-h-14 min-w-0 py-1.5 ${placementSelectedIndex === index ? 'bg-blue-50 dark:bg-blue-500/10' : ''}`}>
                  {editingItemName === index ? (
                    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" onBlur={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                      commitItem(index)
                    }}>
                      <label className="min-w-0">
                        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">名称</span>
                        <input autoFocus type="text" value={itemNameDrafts[index] ?? item.displayName} maxLength={40} onChange={(event) => setItemNameDrafts((drafts) => drafts.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} onKeyDown={(event) => {
                        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                        event.preventDefault()
                        itemTagInputRef.current?.focus()
                      }} className="min-h-11 w-full min-w-0 rounded-md border border-blue-300 bg-white px-3 text-base text-gray-900 outline-none ring-2 ring-blue-100 dark:border-blue-500/50 dark:bg-white/[0.05] dark:text-gray-100 dark:ring-blue-500/10" aria-label={`餐品名称 ${index + 1}`} />
                      </label>
                      <label className="min-w-0">
                        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">标签</span>
                        <input ref={itemTagInputRef} type="text" value={itemTagDrafts[index] ?? item.tags.join('，')} onChange={(event) => setItemTagDrafts((drafts) => drafts.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} onKeyDown={(event) => {
                          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                          event.preventDefault()
                          commitItem(index)
                        }} className="min-h-11 w-full min-w-0 rounded-md border border-blue-300 bg-white px-3 text-base text-gray-900 outline-none ring-2 ring-blue-100 dark:border-blue-500/50 dark:bg-white/[0.05] dark:text-gray-100 dark:ring-blue-500/10" aria-label={`餐品标签 ${index + 1}`} />
                      </label>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => commitItem(index)} className="min-h-11 shrink-0 rounded-md px-3 text-sm font-medium text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300">完成</button>
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-2">
                      <button type="button" onClick={() => setPlacementSelectedIndex(index)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`定位餐品 ${index + 1}`} aria-pressed={placementSelectedIndex === index}>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold tabular-nums text-white">{index + 1}</span>
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1">
                        <span className="min-w-0 break-words text-sm font-medium text-gray-900 dark:text-gray-100">{itemNameDrafts[index] ?? item.displayName}</span>
                        {normalizeTags(itemTagDrafts[index] ?? item.tags.join('，')).map((tag, tagIndex) => (
                          <span key={`${tag}-${tagIndex}`} className="max-w-full break-words rounded-full bg-gray-100 px-2 py-1 text-xs leading-5 text-gray-600 dark:bg-white/[0.07] dark:text-gray-300">{tag}</span>
                        ))}
                        </div>
                      </button>
                      <button type="button" onClick={() => { setPlacementSelectedIndex(index); setEditingItemName(index) }} disabled={locked} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-gray-400" aria-label={`编辑餐品与标签 ${index + 1}`}>
                        <EditIcon className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <details className="group border-y border-gray-200 py-2 dark:border-white/[0.08]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-gray-600 marker:hidden dark:text-gray-300">
              <span>原始素材</span>
              <ChevronDownIcon className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-3 pb-2 pt-2">
              {props.imageDataUrl && <img src={props.imageDataUrl} alt="原始餐品" className="max-h-52 w-full rounded-md bg-gray-50 object-contain dark:bg-black/20" />}
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-3 font-sans text-sm leading-relaxed text-gray-600 dark:bg-white/[0.03] dark:text-gray-300">{props.userPrompt}</pre>
              <button type="button" onClick={props.onReparse} disabled={locked} className="min-h-11 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 disabled:opacity-50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200">修改素材</button>
            </div>
          </details>

            {(reviewError || props.pageError) && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{reviewError || props.pageError}</div>}
            <div className="sr-only" aria-live="polite">审查 {props.orderResult.titles.length} 个海报标题和 {props.orderResult.items.length} 个餐品</div>
          </div>
        </div>
      )}

      {(phase === 'generating' || phase === 'results') && (
        <div
          ref={generateSplitContainerRef}
          className={`flex flex-col gap-3 pb-4 sm:gap-4 lg:col-span-2 lg:row-start-2 lg:flex-row lg:items-stretch lg:gap-0 lg:pb-3 ${generateSplitDragging ? 'lg:select-none' : ''}`}
          aria-label="生成与保存工作区"
        >
          {/* 移动端先结果后预览；桌面左右分栏 + 中间可拖拽调整宽度 */}
          {currentCandidate && (
            <section
              aria-label="当前海报"
              className="order-3 min-w-0 lg:order-none lg:min-w-[280px] lg:pr-1"
              style={isDesktopGenerateSplit ? { flexBasis: `${generateSplitLeftPercent}%`, flexGrow: 0, flexShrink: 0 } : undefined}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="min-w-0 break-words text-sm font-semibold text-gray-900 dark:text-gray-100">{currentCandidate.title}</h2>
                {currentResultSlotNumber > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400" aria-label={`第 ${currentResultSlotNumber} 张，已出 ${completionOrderNumbers.size} 张`}>第 {currentResultSlotNumber} 张 · 已出 {completionOrderNumbers.size} 张</span>
                )}
              </div>
              <div className="relative flex min-h-40 items-center justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-black/30 sm:min-h-72" onTouchStart={(event) => { touchStartXRef.current = event.touches[0]?.clientX ?? null }} onTouchEnd={handleTouchEnd}>
                {selectedImageSrc ? (
                  <button type="button" onClick={() => {
                    if (currentResultSlot) dismissFreshSlot(currentResultSlot.key)
                    props.onTaskClick(currentCandidate.task)
                  }} className="flex h-full min-h-40 w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:min-h-72" aria-label={`查看 ${currentCandidate.title} 详情`}>
                    <img src={selectedImageSrc} alt={currentCandidate.title} className="max-h-[28svh] w-full object-contain sm:max-h-[58svh]" />
                  </button>
                ) : (
                  <div className="text-sm text-gray-500 dark:text-gray-400">正在载入图片...</div>
                )}
                {availableCandidates.length > 1 && (
                  <>
                    <button type="button" onClick={() => moveSelection(-1)} className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md bg-black/45 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="上一张海报">
                      <ChevronLeftIcon className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => moveSelection(1)} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md bg-black/45 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="下一张海报">
                      <ChevronRightIcon className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
              <div className="hide-scrollbar mt-2 flex min-h-14 gap-2 overflow-x-auto pb-1 sm:min-h-16">
                {availableCandidates.map((candidate, candidateIndex) => {
                  const slot = findAfternoonTeaResultSlotForCandidate(resultSlots, candidate)
                  const slotNumber = slot ? (completionOrderNumbers.get(slot.key) ?? 0) : 0
                  const isFresh = slot ? freshSlotKeys.includes(slot.key) : false
                  return (
                    <button key={candidate.itemId} type="button" onClick={() => {
                      if (slot) dismissFreshSlot(slot.key)
                      setSelectedItemId(candidate.itemId)
                    }} className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-black/20 sm:h-16 sm:w-16 ${candidate.itemId === selectedItemId ? 'border-blue-600' : 'border-transparent'}`} aria-label={`选择海报 ${candidate.title}`} aria-pressed={candidate.itemId === selectedItemId}>
                      {thumbnails[candidate.imageId] ? <img src={thumbnails[candidate.imageId]} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-gray-400">{slotNumber || candidateIndex + 1}</span>}
                      {slotNumber > 0 && <span className="absolute left-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">{slotNumber}</span>}
                      {isFresh && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-blue-500" aria-label="新" />}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {currentCandidate && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整预览与结果区域宽度"
              aria-valuemin={GENERATE_SPLIT_MIN_LEFT_PERCENT}
              aria-valuemax={GENERATE_SPLIT_MAX_LEFT_PERCENT}
              aria-valuenow={Math.round(generateSplitLeftPercent)}
              tabIndex={0}
              className={`group relative z-10 hidden w-3 shrink-0 cursor-col-resize touch-none items-stretch justify-center lg:flex ${generateSplitDragging ? 'bg-blue-50/80 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}
              onPointerDown={handleGenerateSplitPointerDown}
              onPointerMove={handleGenerateSplitPointerMove}
              onPointerUp={finishGenerateSplitDrag}
              onPointerCancel={finishGenerateSplitDrag}
              onDoubleClick={resetGenerateSplit}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  setGenerateSplitLeftPercent((current) => {
                    const next = clampGenerateSplitLeftPercent(current - 2)
                    writeGenerateSplitLeftPercent(next)
                    return next
                  })
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault()
                  setGenerateSplitLeftPercent((current) => {
                    const next = clampGenerateSplitLeftPercent(current + 2)
                    writeGenerateSplitLeftPercent(next)
                    return next
                  })
                } else if (event.key === 'Home' || event.key === 'Enter') {
                  event.preventDefault()
                  resetGenerateSplit()
                }
              }}
            >
              <div className={`my-3 w-px self-stretch transition-colors ${generateSplitDragging ? 'bg-blue-500' : 'bg-gray-300 group-hover:bg-blue-400 dark:bg-white/[0.16] dark:group-hover:bg-blue-400'}`} />
              <div className={`absolute top-1/2 left-1/2 flex h-10 w-3.5 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border border-gray-200 bg-white shadow-sm transition dark:border-white/[0.12] dark:bg-gray-900 ${generateSplitDragging ? 'border-blue-400 ring-2 ring-blue-500/30' : 'group-hover:border-blue-300'}`} aria-hidden="true">
                <span className="h-0.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
                <span className="h-0.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
                <span className="h-0.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
              </div>
            </div>
          )}

          <div
            className={`order-1 min-w-0 space-y-4 lg:order-none lg:min-w-[300px] lg:pl-1 ${currentCandidate ? '' : 'lg:w-full'}`}
            style={isDesktopGenerateSplit && currentCandidate
              ? { flexBasis: `${100 - generateSplitLeftPercent}%`, flexGrow: 1, flexShrink: 1, minWidth: GENERATE_SPLIT_MIN_RIGHT_PX }
              : undefined}
          >
            <section aria-label="生成状态">
              <div className="grid grid-cols-3 gap-x-3 gap-y-1 border-y border-gray-200 py-3 text-xs text-gray-600 dark:border-white/[0.08] dark:text-gray-300" aria-live="polite">
                <span>总数 {resultSlots.length}</span>
                <span>完成 {counters.done}</span>
                <span>失败 {counters.error}</span>
                <span>等待 {counters.queued}</span>
                <span>生成中 {counters.running}</span>
                <span>耗时 {formatElapsed(batchElapsed)}</span>
                {latestFreshSlotNumber > 0 && <span>刚出图：第 {latestFreshSlotNumber} 张</span>}
              </div>
            </section>

            <section aria-label="批次结果槽位" className="min-w-0">
              {/* 按可用宽度自动换列，单卡宽度接近画廊；窄时 1 列，够宽 2/3 列 */}
              <div
                data-generate-result-grid
                className="grid grid-cols-1 gap-3 sm:[grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr))]"
              >
                {resultSlots.map((slot) => slot.task ? (
                  <div key={slot.key} data-mobile-result-slot={slot.itemId} data-task-card={slot.task.id} data-result-slot-number={completionOrderNumbers.get(slot.key) || undefined} data-result-slot-fresh={freshSlotKeys.includes(slot.key) ? 'true' : undefined} className={`relative min-w-0 ${freshSlotKeys.includes(slot.key) ? 'rounded-xl ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-950' : ''}`}>
                    {completionOrderNumbers.has(slot.key) && (
                      <>
                        <span className="sr-only">第 {completionOrderNumbers.get(slot.key)} 张</span>
                        <span className="pointer-events-none absolute right-2 top-2 z-20 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-sm">第 {completionOrderNumbers.get(slot.key)} 张</span>
                      </>
                    )}
                    {freshSlotKeys.includes(slot.key) && <span className="pointer-events-none absolute right-2 top-8 z-20 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">新</span>}
                    <TaskCard
                      task={slot.task}
                      disableSwipe
                      retryDisabled={props.busy || props.retryDisabled}
                      onClick={() => {
                        dismissFreshSlot(slot.key)
                        props.onTaskClick(slot.task!)
                      }}
                      onDelete={() => props.onTaskDelete?.(slot.task!)}
                      onReuse={() => props.onTaskReuse?.(slot.task!)}
                      onEditOutputs={() => props.onTaskEditOutputs?.(slot.task!)}
                      onRetry={() => props.onRetry(slot.itemId, slot.task?.id)}
                    />
                  </div>
                ) : (
                  <div key={slot.key} data-mobile-result-slot={slot.itemId} data-result-slot-number={completionOrderNumbers.get(slot.key) || undefined} className="relative flex min-h-14 min-w-0 items-center gap-2 rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08]">
                    {completionOrderNumbers.has(slot.key) && (
                      <>
                        <span className="sr-only">第 {completionOrderNumbers.get(slot.key)} 张</span>
                        <span className="flex h-6 shrink-0 items-center justify-center rounded-full bg-blue-600 px-2 text-[11px] font-semibold tabular-nums text-white">第 {completionOrderNumbers.get(slot.key)} 张</span>
                      </>
                    )}
                    <span className={`h-2 w-2 shrink-0 rounded-full ${slot.status === 'done' ? 'bg-emerald-500' : slot.status === 'error' ? 'bg-red-500' : slot.status === 'running' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm font-medium text-gray-900 dark:text-gray-100">{slot.title}</div>
                      {slot.profileName && <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{slot.profileName}</div>}
                      <div className="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400">{slot.status === 'done' ? '已完成' : slot.status === 'running' ? '生成中' : slot.status === 'queued' ? '等待生成' : slot.error || '生成失败'}</div>
                    </div>
                    {slot.status === 'error' && (
                      <button type="button" onClick={() => props.onRetry(slot.itemId)} disabled={props.busy || props.retryDisabled} className="min-h-11 shrink-0 rounded-md px-2 text-sm font-medium text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50 dark:text-red-300">重试</button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {(props.pageError || saveStatus) && <div role={props.pageError || saveStatus.startsWith('无法') ? 'alert' : 'status'} className={`rounded-md px-3 py-2.5 text-sm ${props.pageError || saveStatus.startsWith('无法') ? 'border border-red-200 bg-red-50 text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300' : 'bg-gray-100 text-gray-600 dark:bg-white/[0.05] dark:text-gray-300'}`}>{props.pageError || saveStatus}</div>}

            <details className="group border-y border-gray-200 py-2 dark:border-white/[0.08]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-gray-600 marker:hidden dark:text-gray-300">
                <span>生成详情</span>
                <ChevronDownIcon className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 pb-2 pt-2">
                {props.imageDataUrl && <img src={props.imageDataUrl} alt="生成原图" className="max-h-48 w-full rounded-md bg-gray-50 object-contain dark:bg-black/20" />}
                {props.items.map((item) => (
                  <details key={item.id} className="border-t border-gray-200 py-1 first:border-0 dark:border-white/[0.08]">
                    <summary className="flex min-h-11 cursor-pointer items-center break-words text-sm font-medium text-gray-700 dark:text-gray-200">{item.title}</summary>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-gray-500 dark:text-gray-400">{item.prompt}</pre>
                  </details>
                ))}
              </div>
            </details>
          </div>
        </div>
      )}

      {(phase !== 'results' || availableCandidates.length > 0) && <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-3 pt-2.5 pb-[calc(0.65rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/95 dark:shadow-[0_-8px_24px_rgba(0,0,0,0.35)] sm:px-6 lg:static lg:inset-auto lg:col-start-2 lg:row-start-1 lg:mx-0 lg:mb-4 lg:mt-0 lg:flex lg:justify-end lg:border-t-0 lg:bg-transparent lg:px-0 lg:py-0 lg:shadow-none lg:backdrop-blur-none dark:lg:bg-transparent" aria-label="工作流主操作">
        {phase === 'input' && (
          <button type="button" onClick={() => {
            clipboardCoordinator.invalidate()
            props.onSubmit()
          }} disabled={!props.configured || locked || !props.userPrompt.trim()} className="min-h-12 w-full touch-manipulation rounded-xl bg-blue-600 px-4 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99] lg:w-auto lg:min-w-56 lg:rounded-md">开始解析</button>
        )}
        {phase === 'analyzing' && (
          <button type="button" onClick={props.onCancel} className="min-h-12 w-full touch-manipulation rounded-xl border border-gray-300 bg-white px-4 text-base font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-[0.99] dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-100 lg:w-auto lg:min-w-56 lg:rounded-md">取消解析</button>
        )}
        {phase === 'review' && (
          <div className="w-full lg:w-auto">
            <button type="button" onClick={handleConfirmAndGenerate} disabled={locked || !props.imageDataUrl || !props.orderResult} className="min-h-12 w-full touch-manipulation rounded-xl bg-blue-600 px-4 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99] lg:w-auto lg:min-w-56 lg:rounded-md">确认并生成 {props.orderResult?.titles.length ?? 0} 张</button>
            {!props.imageDataUrl && <div className="mt-1.5 text-center text-xs text-amber-700 dark:text-amber-300">生成海报需要一张餐品图片</div>}
          </div>
        )}
        {phase === 'generating' && (
          <button type="button" disabled className="flex min-h-12 w-full cursor-wait items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 text-base font-semibold text-gray-700 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-gray-200 lg:w-auto lg:min-w-56 lg:rounded-md">
            <span>生成中 {counters.done + counters.error} / {resultSlots.length}</span>
            <WandAnimation size={28} className="dark:invert" />
          </button>
        )}
        {phase === 'results' && availableCandidates.length > 0 && (
          <button type="button" onClick={() => void handleSave()} disabled={!preparedFile || preparingFile || saving} className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99] lg:w-auto lg:min-w-56 lg:rounded-md" aria-label="保存当前海报图片">
            <DownloadIcon className="h-5 w-5" />
            {preparingFile ? '准备图片...' : saving ? '正在打开...' : '打开系统保存'}
          </button>
        )}
      </div>}
    </div>
  )
}
