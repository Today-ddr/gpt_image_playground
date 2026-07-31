import { useEffect, useMemo, useRef, useState, type ChangeEvent, type TouchEvent } from 'react'
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
import { WandAnimation } from '../wand-animation-react'
import type { AfternoonTeaPosterViewItem } from './AfternoonTeaPosterStep'
import { AfternoonTeaItemPlacement } from './AfternoonTeaTitlePlacement'

export type MobileAfternoonTeaPhase = 'input' | 'analyzing' | 'review' | 'generating' | 'results'

type MobileAfternoonTeaPhaseState = {
  orderResult: AfternoonTeaOrderResult | null
  analysisStatus: 'idle' | 'running' | 'success' | 'error' | 'cancelled'
  batchStartedAt: number | null
  batchFinishedAt: number | null
}

export type MobileAfternoonTeaCandidate = {
  itemId: string
  title: string
  imageId: string
  task: TaskRecord
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
  onRetry: (itemId: string) => void
  onTaskClick: (task: TaskRecord) => void
}

export function deriveMobileAfternoonTeaPhase(state: MobileAfternoonTeaPhaseState): MobileAfternoonTeaPhase {
  if (state.batchFinishedAt != null) return 'results'
  if (state.batchStartedAt != null) return 'generating'
  if (state.orderResult) return 'review'
  if (state.analysisStatus === 'running') return 'analyzing'
  return 'input'
}

export function getMobileAfternoonTeaCandidates(items: AfternoonTeaPosterViewItem[]): MobileAfternoonTeaCandidate[] {
  return items.flatMap((item) => {
    const imageId = item.status === 'done' ? item.task?.outputImages[0] : null
    if (!imageId || !item.task) return []
    return [{ itemId: item.id, title: item.title, imageId, task: item.task }]
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
  const [clipboardError, setClipboardError] = useState('')
  const [clipboardAvailable] = useState(canReadAfternoonTeaClipboard)
  const [clipboardCoordinator] = useState(createAfternoonTeaClipboardCoordinator)
  const [now, setNow] = useState(Date.now())
  const reviewRef = useRef<HTMLDivElement>(null)
  const itemTagInputRef = useRef<HTMLInputElement>(null)
  const previousPhaseRef = useRef(phase)
  const touchStartXRef = useRef<number | null>(null)
  const titleKey = props.orderResult?.titles.join('\u0001') ?? ''
  const itemNameKey = props.orderResult?.items.map((item) => item.displayName).join('\u0001') ?? ''
  const itemTagKey = props.orderResult?.items.map((item) => item.tags.join('\u0001')).join('\u0002') ?? ''

  useEffect(() => {
    setPosterTitleDrafts(props.orderResult?.titles ?? [])
    setEditingPosterTitle(null)
    setReviewError('')
  }, [titleKey])
  useEffect(() => {
    setItemNameDrafts(props.orderResult?.items.map((item) => item.displayName) ?? [])
    setEditingItemName(null)
  }, [itemNameKey])
  useEffect(() => {
    setItemTagDrafts(props.orderResult?.items.map((item) => item.tags.join('，')) ?? [])
  }, [itemTagKey])
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
  const availableCandidates = candidates.filter((candidate) => !unavailableImageIds.includes(candidate.imageId))
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

  const counters = props.items.reduce((result, item) => ({
    ...result,
    [item.status]: result[item.status] + 1,
  }), { queued: 0, running: 0, done: 0, error: 0 })
  const batchElapsed = props.batchStartedAt == null
    ? null
    : Math.max(0, (props.batchFinishedAt ?? now) - props.batchStartedAt)
  const currentCandidate = availableCandidates.find((candidate) => candidate.itemId === selectedItemId) ?? null
  const selectedIndex = currentCandidate
    ? availableCandidates.findIndex((candidate) => candidate.itemId === currentCandidate.itemId)
    : -1
  const locked = props.locked || props.busy || props.imageLoading

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    props.onImageChange(event.target.files?.[0] ?? null)
    event.target.value = ''
  }
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
    <div className="min-w-0 px-4 py-5 sm:px-6 sm:py-7 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-x-6" data-mobile-afternoon-tea-workflow aria-label="餐品海报工作流">
      <div className="mb-4 lg:col-start-1 lg:row-start-1" aria-label="餐品海报进度">
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
        <div className="space-y-4 pb-3 lg:col-span-2 lg:row-start-2 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)] lg:items-start lg:gap-6 lg:space-y-0" aria-label="素材工作区">
          <section aria-label="餐品图片">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">餐品图片</h2>
              {props.imageDataUrl && (
                <button type="button" onClick={props.onRemoveImage} disabled={locked || props.imageLoading} className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" aria-label="移除餐品图片">
                  <CloseIcon className="h-5 w-5" />
                </button>
              )}
            </div>
            {props.imageDataUrl ? (
              <div className="flex max-h-[38svh] min-h-44 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-white/[0.08] dark:bg-black/20">
                <img src={props.imageDataUrl} alt="待解析餐品" className="max-h-[38svh] w-full object-contain" />
              </div>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50/60 px-4 text-center text-sm text-gray-500 dark:border-white/[0.12] dark:bg-white/[0.02] dark:text-gray-400">
                {props.imageLoading ? '正在读取图片...' : props.imageMissing ? '原图不可用，请重新选择' : '选择一张餐品图片'}
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className={`flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-medium text-blue-700 has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 ${locked ? 'pointer-events-none opacity-50' : ''}`}>
                <CameraIcon className="h-5 w-5" />
                <span>拍照</span>
                <input type="file" accept="image/*" capture="environment" disabled={locked} onChange={handleImageInputChange} className="sr-only" aria-label="拍照" />
              </label>
              <label className={`flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 ${locked ? 'pointer-events-none opacity-50' : ''}`}>
                <ImportIcon className="h-5 w-5" />
                <span>照片</span>
                <input type="file" accept="image/*" disabled={locked} onChange={handleImageInputChange} className="sr-only" aria-label="选择照片" />
              </label>
            </div>
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
              }} disabled={locked} rows={7} className="min-h-40 w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-base leading-relaxed text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:ring-blue-500/10" aria-label="菜单输入" />
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
        <div ref={reviewRef} className="space-y-5 pb-3 scroll-mt-20 lg:col-span-2 lg:row-start-2 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)] lg:items-start lg:gap-6 lg:space-y-0" aria-label="审查工作区">
          <section aria-label="餐品摆放">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">餐品摆放</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">{props.orderResult.items.length} 个餐品</span>
            </div>
            <AfternoonTeaItemPlacement imageSrc={props.imageDataUrl} items={props.orderResult.items} regions={props.itemTitleRegions} locked={locked} onChange={props.onItemTitleRegionsChange} />
          </section>

          <div className="space-y-5">
            <section aria-label="海报标题">
              <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">海报标题</h2>
              <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-white/[0.08] dark:border-white/[0.08]">
                {props.orderResult.titles.map((title, index) => (
                  <div key={`${index}-${title}`} role="group" aria-label={`海报标题 ${String(index + 1).padStart(2, '0')}`} className="flex min-h-16 min-w-0 items-center gap-2 bg-blue-50 px-2 py-2 dark:bg-blue-500/10">
                    <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-blue-600 dark:text-blue-300">{String(index + 1).padStart(2, '0')}</span>
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
                        <span className="min-w-0 flex-1 break-words text-base font-semibold text-blue-950 dark:text-blue-100">{title}</span>
                        <button type="button" onClick={() => setEditingPosterTitle(index)} disabled={locked} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-gray-400" aria-label={`编辑海报标题 ${index + 1}`}>
                          <EditIcon className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>

          <section aria-label="餐品与标签">
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">餐品与标签</h2>
            <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-white/[0.08] dark:border-white/[0.08]">
              {props.orderResult.items.map((item, index) => (
                <div key={`${index}-${item.displayName}`} className="min-h-14 min-w-0 py-1.5">
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
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1">
                        <span className="min-w-0 break-words text-sm font-medium text-gray-900 dark:text-gray-100">{itemNameDrafts[index] ?? item.displayName}</span>
                        {normalizeTags(itemTagDrafts[index] ?? item.tags.join('，')).map((tag, tagIndex) => (
                          <span key={`${tag}-${tagIndex}`} className="max-w-full break-words rounded-full bg-gray-100 px-2 py-1 text-xs leading-5 text-gray-600 dark:bg-white/[0.07] dark:text-gray-300">{tag}</span>
                        ))}
                      </div>
                      <button type="button" onClick={() => setEditingItemName(index)} disabled={locked} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-gray-400" aria-label={`编辑餐品与标签 ${index + 1}`}>
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
        <div className="space-y-4 pb-3 lg:col-span-2 lg:row-start-2 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-start lg:gap-6 lg:space-y-0" aria-label="生成与保存工作区">
          {currentCandidate && (
            <section aria-label="当前海报">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="min-w-0 break-words text-sm font-semibold text-gray-900 dark:text-gray-100">{currentCandidate.title}</h2>
                <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">{selectedIndex + 1} / {availableCandidates.length}</span>
              </div>
              <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-black/30" onTouchStart={(event) => { touchStartXRef.current = event.touches[0]?.clientX ?? null }} onTouchEnd={handleTouchEnd}>
                {selectedImageSrc ? (
                  <button type="button" onClick={() => props.onTaskClick(currentCandidate.task)} className="flex h-full min-h-72 w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" aria-label={`查看 ${currentCandidate.title} 详情`}>
                    <img src={selectedImageSrc} alt={currentCandidate.title} className="max-h-[58svh] w-full object-contain" />
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
              <div className="hide-scrollbar mt-2 flex min-h-16 gap-2 overflow-x-auto pb-1">
                {availableCandidates.map((candidate) => (
                  <button key={candidate.itemId} type="button" onClick={() => setSelectedItemId(candidate.itemId)} className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-black/20 ${candidate.itemId === selectedItemId ? 'border-blue-600' : 'border-transparent'}`} aria-label={`选择海报 ${candidate.title}`} aria-pressed={candidate.itemId === selectedItemId}>
                    {thumbnails[candidate.imageId] ? <img src={thumbnails[candidate.imageId]} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-gray-400">{availableCandidates.indexOf(candidate) + 1}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className={`space-y-4 ${currentCandidate ? 'lg:col-start-2 lg:row-start-1' : 'lg:col-span-2'}`}>
            <section aria-label="生成状态">
              <div className="grid grid-cols-3 gap-x-3 gap-y-1 border-y border-gray-200 py-3 text-xs text-gray-600 dark:border-white/[0.08] dark:text-gray-300" aria-live="polite">
                <span>总数 {props.items.length}</span>
                <span>完成 {counters.done}</span>
                <span>失败 {counters.error}</span>
                <span>等待 {counters.queued}</span>
                <span>生成中 {counters.running}</span>
                <span>耗时 {formatElapsed(batchElapsed)}</span>
              </div>
            </section>

            <section aria-label="批次结果槽位">
              <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-white/[0.08] dark:border-white/[0.08]">
                {props.items.map((item) => (
                  <div key={item.id} data-mobile-result-slot={item.id} className="flex min-h-14 min-w-0 items-center gap-2 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${item.status === 'done' ? 'bg-emerald-500' : item.status === 'error' ? 'bg-red-500' : item.status === 'running' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm font-medium text-gray-900 dark:text-gray-100">{item.title}</div>
                      <div className="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400">{item.status === 'done' ? '已完成' : item.status === 'running' ? '生成中' : item.status === 'queued' ? '等待生成' : item.error || '生成失败'}</div>
                    </div>
                    {item.status === 'error' && (
                      <button type="button" onClick={() => props.onRetry(item.id)} disabled={props.busy || props.retryDisabled} className="min-h-11 shrink-0 rounded-md px-2 text-sm font-medium text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50 dark:text-red-300">重试</button>
                    )}
                    {item.task && (
                      <button type="button" onClick={() => {
                        if (!item.task) return
                        props.onTaskClick(item.task)
                      }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400" aria-label={`查看 ${item.title} 任务详情`}>
                        <ChevronRightIcon className="h-5 w-5" />
                      </button>
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

      {(phase !== 'results' || availableCandidates.length > 0) && <div className="sticky bottom-0 z-20 -mx-4 mt-3 border-t border-gray-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/95 sm:-mx-6 sm:px-6 lg:static lg:col-start-2 lg:row-start-1 lg:mx-0 lg:mb-4 lg:flex lg:justify-end lg:border-t-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none dark:lg:bg-transparent" aria-label="工作流主操作">
        {phase === 'input' && (
          <button type="button" onClick={() => {
            clipboardCoordinator.invalidate()
            props.onSubmit()
          }} disabled={!props.configured || locked || !props.userPrompt.trim()} className="min-h-12 w-full rounded-md bg-blue-600 px-4 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto lg:min-w-56">开始解析</button>
        )}
        {phase === 'analyzing' && (
          <button type="button" onClick={props.onCancel} className="min-h-12 w-full rounded-md border border-gray-300 bg-white px-4 text-base font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-100 lg:w-auto lg:min-w-56">取消解析</button>
        )}
        {phase === 'review' && (
          <div className="w-full lg:w-auto">
            <button type="button" onClick={handleConfirmAndGenerate} disabled={locked || !props.imageDataUrl || !props.orderResult} className="min-h-12 w-full rounded-md bg-blue-600 px-4 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto lg:min-w-56">确认并生成 {props.orderResult?.titles.length ?? 0} 张</button>
            {!props.imageDataUrl && <div className="mt-1.5 text-center text-xs text-amber-700 dark:text-amber-300">生成海报需要一张餐品图片</div>}
          </div>
        )}
        {phase === 'generating' && (
          <button type="button" disabled className="flex min-h-12 w-full cursor-wait items-center justify-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-4 text-base font-semibold text-gray-700 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-gray-200 lg:w-auto lg:min-w-56">
            <span>生成中 {counters.done + counters.error} / {props.items.length}</span>
            <WandAnimation size={28} className="dark:invert" />
          </button>
        )}
        {phase === 'results' && availableCandidates.length > 0 && (
          <button type="button" onClick={() => void handleSave()} disabled={!preparedFile || preparingFile || saving} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto lg:min-w-56" aria-label="保存当前海报图片">
            <DownloadIcon className="h-5 w-5" />
            {preparingFile ? '准备图片...' : saving ? '正在打开...' : '打开系统保存'}
          </button>
        )}
      </div>}
    </div>
  )
}
