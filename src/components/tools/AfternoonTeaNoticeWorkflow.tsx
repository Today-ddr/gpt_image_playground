import { useEffect, useRef, useState } from 'react'
import {
  applyAfternoonTeaNoticeText,
  buildAfternoonTeaNoticeUserPrompt,
  getAfternoonTeaNoticePrimaryActionLabel,
  parseAfternoonTeaNoticeResultForStyles,
  pickAfternoonTeaNoticeStyles,
  readAfternoonTeaNoticeDraft,
  readAfternoonTeaNoticeSystemPrompt,
  resolveAfternoonTeaNoticeSelectedIndex,
  validateAfternoonTeaNoticeInput,
  writeAfternoonTeaNoticeDraft,
  writeAfternoonTeaNoticeSystemPrompt,
  type AfternoonTeaNotice,
  type AfternoonTeaNoticeStatus,
} from '../../lib/afternoonTeaNotice'
import { generateAfternoonTeaNotice } from '../../lib/afternoonTeaNoticeApi'
import { AFTERNOON_TEA_NOTICE_RESULT_COUNT, DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT } from '../../lib/afternoonTeaNoticePrompts'
import { getActiveApiProfile } from '../../lib/apiProfiles'
import { copyTextToClipboard, getClipboardFailureMessage } from '../../lib/clipboard'
import { useStore } from '../../store'
import { ChevronDownIcon, CopyIcon, PasteIcon } from '../icons'
import {
  canReadAfternoonTeaClipboard,
  createAfternoonTeaClipboardCoordinator,
} from './AfternoonTeaMobileWorkflow'

function formatElapsed(value: number | null) {
  if (value == null) return '--:--'
  const seconds = Math.floor(Math.max(0, value) / 1_000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function getNoticeStatusLabel(status: AfternoonTeaNoticeStatus, noticeCount: number) {
  if (status === 'running') return '正在生成通知'
  if (status === 'error') return '生成失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'success' || noticeCount > 0) return '已生成，可挑选复制'
  return '等待生成'
}

export type AfternoonTeaNoticeFormViewProps = {
  configured: boolean
  menuText: string
  brand: string
  systemPrompt: string
  notices: AfternoonTeaNotice[]
  selectedIndex: number
  status: AfternoonTeaNoticeStatus
  elapsed: number | null
  error: string
  clipboardAvailable: boolean
  clipboardError: string
  onMenuTextChange: (value: string) => void
  onBrandChange: (value: string) => void
  onSystemPromptChange: (value: string) => void
  onResetSystemPrompt: () => void
  onNoticeTextChange: (index: number, text: string) => void
  onSelectedIndexChange: (index: number) => void
  onPasteMenu: () => void
  onSubmit: () => void
  onCancel: () => void
  onCopy: (text: string) => void
}

export function AfternoonTeaNoticeFormView(props: AfternoonTeaNoticeFormViewProps) {
  const locked = props.status === 'running'
  const selectedIndex = resolveAfternoonTeaNoticeSelectedIndex(props.notices, props.selectedIndex)
  const primaryActionLabel = getAfternoonTeaNoticePrimaryActionLabel(props.status, props.notices.length)
  const primaryDisabled = props.status !== 'running' && (!props.configured || !props.menuText.trim())

  return (
    <div className="min-w-0 px-3 py-3 sm:px-6 sm:py-7 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-x-6" data-afternoon-tea-notice-workflow aria-label="下午茶通知工作流">
      {!props.configured && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 lg:col-span-2">
          请先在 API 配置中选择 OpenAI 配置，并填写语义理解/多模态模型 ID
        </div>
      )}

      <div className="space-y-4 pb-3 sm:space-y-5 lg:col-span-2 lg:row-start-2 lg:grid lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)] lg:items-start lg:gap-6 lg:space-y-0" aria-label="通知工作区">
        <div className="space-y-4">
          <section aria-label="菜单内容">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">今日菜单</h2>
              {props.clipboardAvailable && (
                <button
                  type="button"
                  onClick={props.onPasteMenu}
                  disabled={locked}
                  className="flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-blue-300"
                >
                  <PasteIcon className="h-4 w-4" />
                  粘贴
                </button>
              )}
            </div>
            <textarea
              value={props.menuText}
              onChange={(event) => props.onMenuTextChange(event.target.value)}
              disabled={locked}
              rows={8}
              placeholder={'例如：\n原味巴斯克\n开心果巴斯克\n抹茶巴斯克\n奥利奥巴斯克\n➕\n喜茶羽衣甘蓝双柚'}
              className="min-h-28 w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-base leading-relaxed text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-blue-500/10 sm:min-h-40"
              aria-label="菜单输入"
            />
            {props.clipboardError && (
              <div role="alert" className="mt-2 text-sm text-amber-700 dark:text-amber-300">{props.clipboardError}</div>
            )}
          </section>

          <section aria-label="品牌">
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">品牌（选填）</h2>
            <input
              type="text"
              value={props.brand}
              onChange={(event) => props.onBrandChange(event.target.value)}
              disabled={locked}
              placeholder="例如：捏捏虎、麦当劳"
              className="min-h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-base text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-blue-500/10"
              aria-label="品牌"
            />
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
              <textarea
                value={props.systemPrompt}
                onChange={(event) => props.onSystemPromptChange(event.target.value)}
                disabled={locked}
                rows={8}
                className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-800 outline-none focus:border-blue-400 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-gray-100"
                aria-label="系统提示词"
              />
            </div>
          </details>

          {props.error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{props.error}</div>
          )}
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
            <span>{getNoticeStatusLabel(props.status, props.notices.length)}</span>
            <span className="tabular-nums">耗时 {formatElapsed(props.elapsed)}</span>
          </div>
        </div>

        <section aria-label="通知文案">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">通知文案</h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {props.notices.length > 0 ? `本次 ${props.notices.length} 种` : `每次随机 ${AFTERNOON_TEA_NOTICE_RESULT_COUNT} 种`}
            </span>
          </div>
          {props.notices.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:gap-3" role="list">
              {props.notices.map((notice, index) => {
                const selected = index === selectedIndex
                const canCopy = !locked && Boolean(notice.text.trim())
                return (
                  <button
                    key={notice.style}
                    type="button"
                    role="listitem"
                    onClick={() => {
                      props.onSelectedIndexChange(index)
                      if (canCopy) props.onCopy(notice.text)
                    }}
                    disabled={!canCopy}
                    className={`flex min-h-0 flex-col rounded-xl border px-2.5 py-2.5 text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 enabled:cursor-pointer enabled:active:scale-[0.99] disabled:cursor-not-allowed sm:px-3 sm:py-3 ${selected
                      ? 'border-blue-300 bg-blue-50/70 ring-2 ring-inset ring-blue-400 dark:border-blue-500/40 dark:bg-blue-500/10 dark:ring-blue-500/60'
                      : 'border-gray-200 bg-white dark:border-white/[0.1] dark:bg-white/[0.03]'}`}
                    aria-pressed={selected}
                    aria-label={`复制${notice.style}通知`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-1.5">
                      <span
                        className={`inline-flex max-w-[70%] items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 tracking-wide ${selected
                          ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300'
                          : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'}`}
                        aria-hidden="true"
                      >
                        {notice.style}
                      </span>
                      <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] ${selected ? 'text-blue-600 dark:text-blue-300' : 'text-gray-400 dark:text-gray-500'}`}>
                        <CopyIcon className="h-3.5 w-3.5" />
                        点击复制
                      </span>
                    </div>
                    <pre className="min-h-24 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-gray-700 dark:text-gray-200">{notice.text}</pre>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50/60 px-4 text-center text-sm text-gray-500 dark:border-white/[0.12] dark:bg-white/[0.02] dark:text-gray-400">
              {locked ? `正在随机生成 ${AFTERNOON_TEA_NOTICE_RESULT_COUNT} 种风格…` : `生成后会随机给出 ${AFTERNOON_TEA_NOTICE_RESULT_COUNT} 种风格，方便挑选复制`}
            </div>
          )}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-3 pt-2.5 pb-[calc(0.65rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/95 dark:shadow-[0_-8px_24px_rgba(0,0,0,0.35)] sm:px-6 lg:static lg:inset-auto lg:col-start-2 lg:row-start-1 lg:mx-0 lg:mb-4 lg:mt-0 lg:flex lg:justify-end lg:border-t-0 lg:bg-transparent lg:px-0 lg:py-0 lg:shadow-none lg:backdrop-blur-none dark:lg:bg-transparent" aria-label="工作流主操作">
        {props.status === 'running' ? (
          <button
            type="button"
            onClick={props.onCancel}
            className="min-h-12 w-full touch-manipulation rounded-xl border border-gray-300 bg-white px-4 text-base font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-[0.99] dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-100 lg:w-auto lg:min-w-56 lg:rounded-md"
            aria-label="取消生成"
          >
            {primaryActionLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={primaryDisabled}
            className="min-h-12 w-full touch-manipulation rounded-xl bg-blue-600 px-4 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99] lg:w-auto lg:min-w-56 lg:rounded-md"
            aria-label={primaryActionLabel}
          >
            {primaryActionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

type AfternoonTeaNoticeWorkflowProps = {
  configured: boolean
}

export function AfternoonTeaNoticeWorkflow(props: AfternoonTeaNoticeWorkflowProps) {
  const settings = useStore((state) => state.settings)
  const showToast = useStore((state) => state.showToast)
  const [draft] = useState(readAfternoonTeaNoticeDraft)
  const [menuText, setMenuText] = useState(draft.menuText)
  const [brand, setBrand] = useState(draft.brand)
  const [notices, setNotices] = useState(draft.notices)
  const [selectedIndex, setSelectedIndex] = useState(draft.selectedIndex)
  const [systemPrompt, setSystemPrompt] = useState(readAfternoonTeaNoticeSystemPrompt)
  const [status, setStatus] = useState<AfternoonTeaNoticeStatus>(draft.notices.length > 0 ? 'success' : 'idle')
  const [error, setError] = useState('')
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [finishedElapsed, setFinishedElapsed] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [hydrated, setHydrated] = useState(false)
  const [clipboardError, setClipboardError] = useState('')
  const [clipboardAvailable] = useState(canReadAfternoonTeaClipboard)
  const [clipboardCoordinator] = useState(createAfternoonTeaClipboardCoordinator)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setHydrated(true)
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    writeAfternoonTeaNoticeDraft({ menuText, brand, notices, selectedIndex })
  }, [hydrated, menuText, brand, notices, selectedIndex])

  useEffect(() => {
    if (!hydrated) return
    writeAfternoonTeaNoticeSystemPrompt(systemPrompt)
  }, [hydrated, systemPrompt])

  useEffect(() => {
    if (status !== 'running' || runStartedAt == null) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [status, runStartedAt])

  const elapsed = status === 'running' && runStartedAt != null
    ? Math.max(0, now - runStartedAt)
    : finishedElapsed

  const handlePasteMenu = async () => {
    const result = await clipboardCoordinator.read(menuText)
    if (!result) return
    setClipboardError(result.error)
    if (result.text !== menuText) setMenuText(result.text)
  }

  const handleCopy = async (text: string) => {
    try {
      await copyTextToClipboard(text)
      showToast('已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }

  const cancelGeneration = () => {
    abortRef.current?.abort()
  }

  const submitGeneration = async () => {
    if (status === 'running') return
    try {
      validateAfternoonTeaNoticeInput(menuText)
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : '请填写今日菜单')
      return
    }

    const profile = getActiveApiProfile(settings)
    if (profile.provider !== 'openai' || !profile.understandingModel?.trim()) {
      setStatus('error')
      setError('请先在 API 配置中选择 OpenAI 配置，并填写语义理解/多模态模型 ID')
      return
    }

    clipboardCoordinator.invalidate()
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = Date.now()
    setRunStartedAt(startedAt)
    setFinishedElapsed(null)
    setStatus('running')
    setError('')
    setNow(startedAt)

    try {
      const requestedStyles = pickAfternoonTeaNoticeStyles(notices.map((notice) => notice.style))
      const raw = await generateAfternoonTeaNotice({
        profile,
        userPrompt: buildAfternoonTeaNoticeUserPrompt(menuText, brand, requestedStyles),
        systemPrompt,
        signal: controller.signal,
      })
      const parsed = parseAfternoonTeaNoticeResultForStyles(raw, requestedStyles)
      setNotices(parsed)
      setSelectedIndex(0)
      setStatus('success')
      setFinishedElapsed(Date.now() - startedAt)
    } catch (err) {
      const message = err instanceof Error ? err.message.trim() : ''
      const cancelled = message.includes('已取消') || controller.signal.aborted
      setStatus(cancelled ? 'cancelled' : 'error')
      setError(cancelled ? '' : (message || '下午茶通知生成失败'))
      setFinishedElapsed(Date.now() - startedAt)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunStartedAt(null)
    }
  }

  return (
    <AfternoonTeaNoticeFormView
      configured={props.configured}
      menuText={menuText}
      brand={brand}
      systemPrompt={systemPrompt}
      notices={notices}
      selectedIndex={selectedIndex}
      status={status}
      elapsed={elapsed}
      error={error}
      clipboardAvailable={clipboardAvailable}
      clipboardError={clipboardError}
      onMenuTextChange={(value) => {
        clipboardCoordinator.invalidate()
        setMenuText(value)
      }}
      onBrandChange={setBrand}
      onSystemPromptChange={setSystemPrompt}
      onResetSystemPrompt={() => setSystemPrompt(DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT)}
      onNoticeTextChange={(index, text) => setNotices((current) => applyAfternoonTeaNoticeText(current, index, text))}
      onSelectedIndexChange={setSelectedIndex}
      onPasteMenu={() => void handlePasteMenu()}
      onSubmit={() => void submitGeneration()}
      onCancel={cancelGeneration}
      onCopy={(text) => void handleCopy(text)}
    />
  )
}
