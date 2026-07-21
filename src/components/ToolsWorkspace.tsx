import { useEffect, useRef, useState } from 'react'
import type {
  AfternoonTeaOrderResult,
  AfternoonTeaPosterBatchItem,
  ApiProfile,
  AppSettings,
  InputImage,
  TaskParams,
  TaskRecord,
} from '../types'
import { ensureImageCached, submitAfternoonTeaPosterTask, useStore } from '../store'
import { getActiveApiProfile, normalizeSettings, validateApiProfile } from '../lib/apiProfiles'
import {
  AfternoonTeaBatchCoordinator,
  retryAfternoonTeaPosterItem,
  runAfternoonTeaPosterBatch,
} from '../lib/afternoonTeaBatch'
import { parseAfternoonTeaOrderResult } from '../lib/afternoonTeaOrder'
import { buildAfternoonTeaPosterPrompts } from '../lib/afternoonTeaPosterPromptBuilder'
import { analyzeDish } from '../lib/dishAnalysisApi'
import { fileToDataUrl } from '../lib/dataUrl'
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
import { CloseIcon, ImportIcon } from './icons'
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

export function getDishAnalysisProfile(settings: AppSettings): ApiProfile | null {
  const profile = getActiveApiProfile(settings)
  if (profile.provider !== 'openai' || !profile.understandingModel?.trim()) return null
  return profile
}

export function deriveAfternoonTeaPosterViewItems(
  items: AfternoonTeaPosterBatchItem[],
  tasks: TaskRecord[],
  outputSources: Record<string, string>,
): AfternoonTeaPosterViewItem[] {
  return items.map((item) => {
    if (item.setupError) return { ...item, status: 'error', error: item.setupError }
    if (!item.taskId) return { ...item, status: 'queued' }
    const task = tasks.find((candidate) => candidate.id === item.taskId)
    if (!task) return { ...item, status: 'error', error: '任务记录不存在，请重试此项' }
    const outputImageId = task.status === 'done' ? task.outputImages[0] : undefined
    return {
      ...item,
      status: task.status,
      hasOutput: Boolean(outputImageId),
      outputSrc: outputImageId ? outputSources[outputImageId] : undefined,
      error: task.status === 'error' ? getAfternoonTeaPosterErrorMessage(new Error(task.error || '图片生成失败')) : undefined,
    }
  })
}

export class DishAnalysisCoordinator {
  private imageSelection = 0
  private request: AbortController | null = null

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
  }

  dispose() {
    this.invalidateImageSelection()
    this.request?.abort()
    this.request = null
  }
}

type DishAnalysisFormViewProps = {
  configured: boolean
  imageDataUrl: string
  imageName: string
  userPrompt: string
  systemPrompt: string
  titleCount: number
  orderResult: AfternoonTeaOrderResult | null
  error: string
  loading: boolean
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
    <div className="flex gap-1 border-b border-gray-200 px-0 dark:border-white/[0.08] sm:px-6" aria-label="下午茶海报步骤">
      <button type="button" onClick={() => props.onStepChange('order')} disabled={props.busy} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${props.step === 'order' ? 'border-blue-500 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
        订单解析
      </button>
      <button type="button" onClick={() => props.onStepChange('poster')} disabled={!props.posterEnabled || props.busy} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${props.step === 'poster' ? 'border-blue-500 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
        批量海报
      </button>
    </div>
  )
}

export function DishAnalysisFormView(props: DishAnalysisFormViewProps) {
  const disabled = props.loading || props.locked

  return (
    <div className="min-w-0 flex-1 px-0 py-5 sm:px-6 sm:py-7">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">餐品解析</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">使用当前 API 配置中的语义理解/多模态模型</p>
        </div>
        {!props.configured && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            请先在 API 配置中选择 OpenAI 配置，并填写语义理解/多模态模型 ID
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <section className="min-w-0 space-y-5" aria-label="餐品解析输入">
          <div>
            <div className="mb-1.5 text-sm text-gray-600 dark:text-gray-300">餐品图片（可选）</div>
            {props.imageDataUrl ? (
              <div className="relative overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <img src={props.imageDataUrl} alt="待解析餐品" className="aspect-[4/3] w-full object-contain" />
                <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-3 py-2 dark:border-white/[0.08]">
                  <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">{props.imageName}</span>
                  <button type="button" onClick={props.onRemoveImage} disabled={disabled} className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-gray-200" aria-label="移除餐品图片">
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50/60 text-center transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-white/[0.12] dark:bg-white/[0.02] dark:hover:border-blue-500/40 dark:hover:bg-blue-500/[0.04]">
                <ImportIcon className="mb-3 h-7 w-7 text-gray-400" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">上传餐品图片</span>
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

          <label className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">下午茶订单</span>
            <textarea
              value={props.userPrompt}
              onChange={(event) => props.onUserPromptChange(event.target.value)}
              disabled={disabled}
              rows={3}
              className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:border-blue-500/50"
            />
          </label>

          <label className="block">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="block text-sm text-gray-600 dark:text-gray-300">系统提示词</span>
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
          </label>

          <label className="block max-w-40">
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

          {props.error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              {props.error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {props.loading ? (
              <button type="button" onClick={props.onCancel} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">
                取消解析
              </button>
            ) : (
              <button type="button" onClick={props.onSubmit} disabled={!props.configured || props.locked} className="whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                开始解析
              </button>
            )}
            {(props.orderResult || props.error) && !props.loading && (
              <button type="button" onClick={props.onClear} disabled={props.locked} className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200">
                清空
              </button>
            )}
          </div>
        </section>

        <section className="min-h-[360px] min-w-0 rounded-md border border-gray-200 bg-gray-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.02]" aria-label="解析结果">
          <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-200">解析结果</div>
          {props.loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-gray-400">正在解析...</div>
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
              <button type="button" onClick={props.onGoPoster} disabled={props.locked} className="whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                进入批量海报
              </button>
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-gray-400">解析结果将显示在这里</div>
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
  const analysisProfile = getDishAnalysisProfile(settings)
  const posterProfile = getActiveApiProfile(settings)
  const coordinatorRef = useRef(new DishAnalysisCoordinator())
  const batchCoordinatorRef = useRef(new AfternoonTeaBatchCoordinator())
  const batchActionRef = useRef(false)
  const mountedRef = useRef(true)
  const cachedSourceImageRef = useRef<{ dataUrl: string; id: string } | null>(null)
  const batchRuntimeRef = useRef<{
    batchId: string
    items: AfternoonTeaPosterBatchItem[]
    settingsSnapshot: AppSettings
    paramsSnapshot: TaskParams
    inputImage: InputImage
  } | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [imageName, setImageName] = useState('')
  const [userPrompt, setUserPrompt] = useState(DEFAULT_DISH_USER_PROMPT)
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_DISH_SYSTEM_PROMPT)
  const [titleCount, setTitleCount] = useState(DEFAULT_DISH_TITLE_COUNT)
  const [orderResult, setOrderResult] = useState<AfternoonTeaOrderResult | null>(null)
  const [step, setStep] = useState<'order' | 'poster'>('order')
  const [batchItems, setBatchItems] = useState<AfternoonTeaPosterBatchItem[]>([])
  const [batchStarted, setBatchStarted] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [batchPageError, setBatchPageError] = useState('')
  const [outputSources, setOutputSources] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const viewItems = deriveAfternoonTeaPosterViewItems(batchItems, tasks, outputSources)
  const batchBusy = batchRunning || retrying
  const displayedPosterProfile = batchRuntimeRef.current?.settingsSnapshot
    ? getActiveApiProfile(batchRuntimeRef.current.settingsSnapshot)
    : posterProfile

  useEffect(() => {
    try {
      const savedPrompt = window.localStorage.getItem(DISH_SYSTEM_PROMPT_STORAGE_KEY)
      if (savedPrompt !== null) setSystemPrompt(savedPrompt)
    } catch {
      // localStorage 不可用时继续使用源码默认提示词。
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    batchActionRef.current = false
    batchCoordinatorRef.current = new AfternoonTeaBatchCoordinator()
    return () => {
      mountedRef.current = false
      batchActionRef.current = false
      coordinatorRef.current.dispose()
      batchCoordinatorRef.current.dispose()
    }
  }, [])

  const outputImageIds = batchItems.flatMap((item) => {
    const task = item.taskId ? tasks.find((candidate) => candidate.id === item.taskId) : undefined
    return task?.status === 'done' && task.outputImages[0] ? [task.outputImages[0]] : []
  })
  const outputImageKey = outputImageIds.join('|')

  useEffect(() => {
    let active = true
    for (const id of outputImageIds) {
      if (outputSources[id]) continue
      ensureImageCached(id).then((src) => {
        if (!active || !src) return
        setOutputSources((current) => current[id] ? current : { ...current, [id]: src })
      }).catch((err) => {
        console.warn('加载下午茶海报图片失败', err)
      })
    }
    return () => {
      active = false
    }
  }, [outputImageKey])

  const resetParsedResult = () => {
    setOrderResult(null)
    setBatchItems([])
    setBatchStarted(false)
    setBatchPageError('')
    setOutputSources({})
    batchRuntimeRef.current = null
    setStep('order')
  }

  const updateSystemPrompt = (value: string) => {
    setSystemPrompt(value)
    resetParsedResult()
    try {
      window.localStorage.setItem(DISH_SYSTEM_PROMPT_STORAGE_KEY, value)
    } catch {
      // localStorage 不可用时只保留当前页面的编辑结果。
    }
  }

  const resetSystemPrompt = () => {
    setSystemPrompt(DEFAULT_DISH_SYSTEM_PROMPT)
    resetParsedResult()
    try {
      window.localStorage.removeItem(DISH_SYSTEM_PROMPT_STORAGE_KEY)
    } catch {
      // localStorage 不可用时仍恢复当前页面的源码默认值。
    }
  }

  const handleImageChange = async (file: File | null) => {
    if (!file) return
    const selection = coordinatorRef.current.beginImageSelection()
    setError('')
    try {
      validateDishImageFile(file)
      const dataUrl = await fileToDataUrl(file)
      if (!coordinatorRef.current.isCurrentImageSelection(selection)) return
      cachedSourceImageRef.current = null
      resetParsedResult()
      setImageDataUrl(dataUrl)
      setImageName(file.name)
    } catch (err) {
      if (!coordinatorRef.current.isCurrentImageSelection(selection)) return
      setError(err instanceof Error ? err.message : '读取餐品图片失败')
    }
  }

  const removeImage = () => {
    coordinatorRef.current.invalidateImageSelection()
    cachedSourceImageRef.current = null
    resetParsedResult()
    setImageDataUrl('')
    setImageName('')
  }

  const submit = async () => {
    if (batchBusy) return
    const request = coordinatorRef.current.beginRequest()
    if (!request) return
    resetParsedResult()
    setLoading(true)
    setError('')

    try {
      if (!analysisProfile) throw new Error('请先在 API 配置中选择 OpenAI 配置，并填写语义理解/多模态模型 ID')
      const raw = await analyzeDish({
        profile: analysisProfile,
        imageDataUrl,
        userPrompt: buildDishAnalysisUserPrompt(userPrompt, titleCount),
        systemPrompt: buildDishAnalysisSystemPrompt(systemPrompt, titleCount),
        signal: request.signal,
      })
      const result = parseAfternoonTeaOrderResult(raw, titleCount)
      if (coordinatorRef.current.isCurrentRequest(request)) {
        const itemSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        setOrderResult(result)
        setBatchItems(buildAfternoonTeaPosterPrompts(result).map((item, idx) => ({
          id: `${itemSeed}-${idx}`,
          title: item.title,
          prompt: item.prompt,
        })))
        setBatchStarted(false)
        setBatchPageError('')
        setOutputSources({})
        batchRuntimeRef.current = null
      }
    } catch (err) {
      if (coordinatorRef.current.isCurrentRequest(request)) {
        setError(err instanceof Error ? err.message : '餐品解析失败')
      }
    } finally {
      if (coordinatorRef.current.isCurrentRequest(request)) setLoading(false)
      coordinatorRef.current.finishRequest(request)
    }
  }

  const clear = () => {
    removeImage()
    setError('')
  }

  const startBatch = async () => {
    if (!imageDataUrl || !orderResult || batchItems.length === 0 || batchBusy || batchStarted) return
    if (batchActionRef.current) return
    batchActionRef.current = true
    setBatchRunning(true)
    setBatchPageError('')
    try {
      const settingsSnapshot = normalizeSettings(settings)
      const activeProfile = getActiveApiProfile(settingsSnapshot)
      if (activeProfile.provider !== 'openai') throw new Error('下午茶海报目前仅支持 OpenAI 图片模型配置')
      const profileError = validateApiProfile(activeProfile)
      if (profileError) throw new Error(`请先完善图片 API 配置：${profileError}`)
      const paramsSnapshot = normalizeParamsForSettings({ ...params }, settingsSnapshot, { hasInputImages: true })
      const cachedSource = cachedSourceImageRef.current?.dataUrl === imageDataUrl
        ? cachedSourceImageRef.current
        : null
      const imageId = cachedSource?.id ?? await storeImage(imageDataUrl, 'upload')
      if (!mountedRef.current) return
      cachedSourceImageRef.current = { dataUrl: imageDataUrl, id: imageId }
      const inputImage: InputImage = { id: imageId, dataUrl: imageDataUrl }
      const batchId = `afternoon-tea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const originalItems = batchItems.map((item) => ({ id: item.id, title: item.title, prompt: item.prompt }))
      batchRuntimeRef.current = { batchId, items: originalItems, settingsSnapshot, paramsSnapshot, inputImage }
      setBatchStarted(true)

      await runAfternoonTeaPosterBatch({
        coordinator: batchCoordinatorRef.current,
        batchId,
        items: originalItems,
        settingsSnapshot,
        paramsSnapshot,
        inputImage,
        submit: submitAfternoonTeaPosterTask,
        onTaskCreated: (currentBatchId, itemId, taskId) => {
          if (batchRuntimeRef.current?.batchId !== currentBatchId) return
          setBatchItems((current) => current.map((item) => item.id === itemId
            ? { id: item.id, title: item.title, prompt: item.prompt, taskId }
            : item))
        },
        onItemSetupError: (currentBatchId, itemId, setupError) => {
          if (batchRuntimeRef.current?.batchId !== currentBatchId) return
          const message = getAfternoonTeaPosterErrorMessage(setupError)
          setBatchItems((current) => current.map((item) => item.id === itemId
            ? { id: item.id, title: item.title, prompt: item.prompt, taskId: item.taskId, setupError: message }
            : item))
        },
      })
    } catch (err) {
      if (mountedRef.current) setBatchPageError(getAfternoonTeaPosterErrorMessage(err))
    } finally {
      batchActionRef.current = false
      if (mountedRef.current) setBatchRunning(false)
    }
  }

  const retryItem = async (itemId: string) => {
    const runtime = batchRuntimeRef.current
    const item = runtime?.items.find((candidate) => candidate.id === itemId)
    if (!runtime || !item || batchBusy || !batchCoordinatorRef.current.isTerminal(runtime.batchId)) return
    if (batchActionRef.current) return
    batchActionRef.current = true
    setRetrying(true)
    setBatchPageError('')
    try {
      await retryAfternoonTeaPosterItem({
        coordinator: batchCoordinatorRef.current,
        batchId: runtime.batchId,
        item,
        settingsSnapshot: runtime.settingsSnapshot,
        paramsSnapshot: runtime.paramsSnapshot,
        inputImage: runtime.inputImage,
        submit: submitAfternoonTeaPosterTask,
        onTaskCreated: (currentBatchId, currentItemId, taskId) => {
          if (batchRuntimeRef.current?.batchId !== currentBatchId) return
          setBatchItems((current) => current.map((candidate) => candidate.id === currentItemId
            ? { id: candidate.id, title: candidate.title, prompt: candidate.prompt, taskId }
            : candidate))
        },
        onItemSetupError: (currentBatchId, currentItemId, setupError) => {
          if (batchRuntimeRef.current?.batchId !== currentBatchId) return
          const message = getAfternoonTeaPosterErrorMessage(setupError)
          setBatchItems((current) => current.map((candidate) => candidate.id === currentItemId
            ? { id: candidate.id, title: candidate.title, prompt: candidate.prompt, taskId: candidate.taskId, setupError: message }
            : candidate))
        },
      })
    } catch (err) {
      if (mountedRef.current) setBatchPageError(getAfternoonTeaPosterErrorMessage(err))
    } finally {
      batchActionRef.current = false
      if (mountedRef.current) setRetrying(false)
    }
  }

  const updateUserPrompt = (value: string) => {
    setUserPrompt(value)
    resetParsedResult()
  }

  const updateTitleCount = (value: number) => {
    setTitleCount(normalizeDishTitleCount(value))
    resetParsedResult()
  }

  const reparse = () => {
    resetParsedResult()
    setError('')
  }

  return (
    <main className="safe-area-x mx-auto max-w-7xl pb-12">
      <div className="grid min-h-[calc(100vh-8rem)] sm:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="border-b border-gray-200 py-3 dark:border-white/[0.08] sm:border-b-0 sm:border-r sm:py-6" aria-label="工具列表">
          <div className="px-2 text-xs font-medium text-gray-400 sm:px-3">工具</div>
          <button type="button" className="mt-2 w-full border-l-2 border-blue-500 bg-blue-50/70 px-3 py-2 text-left text-sm font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
            餐品解析
          </button>
        </nav>
        <div className="min-w-0">
          <ToolsWorkflowSteps
            step={step}
            posterEnabled={Boolean(orderResult)}
            busy={batchBusy || loading}
            onStepChange={setStep}
          />
          {step === 'order' ? (
            <DishAnalysisFormView
              configured={Boolean(analysisProfile)}
              imageDataUrl={imageDataUrl}
              imageName={imageName}
              userPrompt={userPrompt}
              systemPrompt={systemPrompt}
              titleCount={titleCount}
              orderResult={orderResult}
              error={error}
              loading={loading}
              locked={batchBusy}
              onImageChange={(file) => void handleImageChange(file)}
              onRemoveImage={removeImage}
              onUserPromptChange={updateUserPrompt}
              onSystemPromptChange={updateSystemPrompt}
              onTitleCountChange={updateTitleCount}
              onResetSystemPrompt={resetSystemPrompt}
              onSubmit={() => void submit()}
              onCancel={() => coordinatorRef.current.cancelRequest()}
              onClear={clear}
              onGoPoster={() => setStep('poster')}
            />
          ) : (
            <AfternoonTeaPosterStep
              sourceImageSrc={imageDataUrl}
              sourceImageName={imageName}
              profileName={displayedPosterProfile.name}
              modelName={`${displayedPosterProfile.model} · ${displayedPosterProfile.apiMode}`}
              items={viewItems}
              busy={batchBusy}
              batchStarted={batchStarted}
              pageError={batchPageError}
              onStart={() => void startBatch()}
              onBack={() => setStep('order')}
              onClear={clear}
              onReparse={reparse}
              onRetry={(itemId) => void retryItem(itemId)}
            />
          )}
        </div>
      </div>
    </main>
  )
}
