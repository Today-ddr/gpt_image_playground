import { useEffect, useRef, useState } from 'react'
import type { ApiProfile, AppSettings } from '../types'
import { useStore } from '../store'
import { getActiveApiProfile } from '../lib/apiProfiles'
import { analyzeDish } from '../lib/dishAnalysisApi'
import { fileToDataUrl } from '../lib/dataUrl'
import { CloseIcon, ImportIcon } from './icons'

export const MAX_DISH_IMAGE_BYTES = 20 * 1024 * 1024

export const DEFAULT_DISH_USER_PROMPT = '请解析这张餐品图片'

export const DEFAULT_DISH_SYSTEM_PROMPT = `你是专业的餐品分析助手。请根据用户提供的餐品图片和补充说明，输出清晰、实用的中文分析。

请尽量包含：
1. 餐品名称或可能的类型
2. 可见的主要食材
3. 可能的烹饪方式
4. 份量与热量、蛋白质、脂肪、碳水化合物的合理估算
5. 可能包含的常见过敏原
6. 需要用户进一步确认的信息

无法从图片确定的内容必须明确标注为估算或不确定，不要把猜测写成事实。`

export function validateDishImageFile(file: Pick<File, 'type' | 'size'>) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > MAX_DISH_IMAGE_BYTES) throw new Error('餐品图片不能超过 20 MiB')
}

export function getDishAnalysisProfile(settings: AppSettings): ApiProfile | null {
  const profile = getActiveApiProfile(settings)
  if (profile.provider !== 'openai' || !profile.understandingModel?.trim()) return null
  return profile
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
  output: string
  error: string
  loading: boolean
  onImageChange: (file: File | null) => void
  onRemoveImage: () => void
  onUserPromptChange: (value: string) => void
  onSystemPromptChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  onClear: () => void
}

export function DishAnalysisFormView(props: DishAnalysisFormViewProps) {
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
            <div className="mb-1.5 text-sm text-gray-600 dark:text-gray-300">餐品图片</div>
            {props.imageDataUrl ? (
              <div className="relative overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <img src={props.imageDataUrl} alt="待解析餐品" className="aspect-[4/3] w-full object-contain" />
                <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-3 py-2 dark:border-white/[0.08]">
                  <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">{props.imageName}</span>
                  <button type="button" onClick={props.onRemoveImage} disabled={props.loading} className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-gray-200" aria-label="移除餐品图片">
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
                  disabled={props.loading}
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
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">用户输入</span>
            <textarea
              value={props.userPrompt}
              onChange={(event) => props.onUserPromptChange(event.target.value)}
              rows={3}
              className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:border-blue-500/50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">系统提示词</span>
            <textarea
              value={props.systemPrompt}
              onChange={(event) => props.onSystemPromptChange(event.target.value)}
              rows={10}
              className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-800 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:border-blue-500/50"
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
              <button type="button" onClick={props.onSubmit} disabled={!props.configured} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                开始解析
              </button>
            )}
            {(props.output || props.error) && !props.loading && (
              <button type="button" onClick={props.onClear} className="rounded-md px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200">
                清空
              </button>
            )}
          </div>
        </section>

        <section className="min-h-[360px] min-w-0 rounded-md border border-gray-200 bg-gray-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.02]" aria-label="文本输出">
          <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-200">文本输出</div>
          {props.loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-gray-400">正在解析...</div>
          ) : props.output ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-gray-700 dark:text-gray-200">{props.output}</pre>
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
  const profile = getDishAnalysisProfile(settings)
  const coordinatorRef = useRef(new DishAnalysisCoordinator())
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [imageName, setImageName] = useState('')
  const [userPrompt, setUserPrompt] = useState(DEFAULT_DISH_USER_PROMPT)
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_DISH_SYSTEM_PROMPT)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => () => coordinatorRef.current.dispose(), [])

  const handleImageChange = async (file: File | null) => {
    if (!file) return
    const selection = coordinatorRef.current.beginImageSelection()
    setError('')
    try {
      validateDishImageFile(file)
      const dataUrl = await fileToDataUrl(file)
      if (!coordinatorRef.current.isCurrentImageSelection(selection)) return
      setImageDataUrl(dataUrl)
      setImageName(file.name)
    } catch (err) {
      if (!coordinatorRef.current.isCurrentImageSelection(selection)) return
      setError(err instanceof Error ? err.message : '读取餐品图片失败')
    }
  }

  const removeImage = () => {
    coordinatorRef.current.invalidateImageSelection()
    setImageDataUrl('')
    setImageName('')
  }

  const submit = async () => {
    const request = coordinatorRef.current.beginRequest()
    if (!request) return
    setLoading(true)
    setError('')

    try {
      if (!profile) throw new Error('请先在 API 配置中选择 OpenAI 配置，并填写语义理解/多模态模型 ID')
      const result = await analyzeDish({
        profile,
        imageDataUrl,
        userPrompt,
        systemPrompt,
        signal: request.signal,
      })
      if (coordinatorRef.current.isCurrentRequest(request)) setOutput(result)
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
    setOutput('')
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
        <DishAnalysisFormView
          configured={Boolean(profile)}
          imageDataUrl={imageDataUrl}
          imageName={imageName}
          userPrompt={userPrompt}
          systemPrompt={systemPrompt}
          output={output}
          error={error}
          loading={loading}
          onImageChange={(file) => void handleImageChange(file)}
          onRemoveImage={removeImage}
          onUserPromptChange={setUserPrompt}
          onSystemPromptChange={setSystemPrompt}
          onSubmit={() => void submit()}
          onCancel={() => coordinatorRef.current.cancelRequest()}
          onClear={clear}
        />
      </div>
    </main>
  )
}
