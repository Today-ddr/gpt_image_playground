import { useEffect, useRef, useState } from 'react'
import { runAfternoonTeaNotice } from '../../lib/afternoonTeaNoticeRun'
import {
  applyAfternoonTeaNoticeText,
  getAfternoonTeaNoticePrimaryActionLabel,
  readAfternoonTeaNoticeDraft,
  readAfternoonTeaNoticeSystemPrompt,
  resolveAfternoonTeaNoticeSelectedIndex,
  validateAfternoonTeaNoticeInput,
  writeAfternoonTeaNoticeDraft,
  writeAfternoonTeaNoticeSystemPrompt,
  type AfternoonTeaNotice,
  type AfternoonTeaNoticeStatus,
} from '../../lib/afternoonTeaNotice'
import { AFTERNOON_TEA_NOTICE_RESULT_COUNT, DEFAULT_AFTERNOON_TEA_NOTICE_SYSTEM_PROMPT } from '../../lib/afternoonTeaNoticePrompts'
import { getActiveApiProfile } from '../../lib/apiProfiles'
import { copyTextToClipboard, getClipboardFailureMessage } from '../../lib/clipboard'
import { useStore } from '../../store'
import { ChevronDownIcon, CopyIcon, PasteIcon } from '../icons'
import { NoticeCopyFlash, noticeCopyFlashKey, useNoticeCopyFlash } from './AfternoonTeaNoticePanel'
import {
  canReadAfternoonTeaClipboard,
  createAfternoonTeaClipboardCoordinator,
  formatAfternoonTeaAnalysisSource,
} from './AfternoonTeaMobileWorkflow'
import { TOOLS_MOBILE_ACTION_DOCK_CLASS, toolsMobileFieldClass, toolsMobilePrimaryButtonClass } from './toolsMobileChrome'

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
  sourceChannel: string
  sourceModel: string
  onMenuTextChange: (value: string) => void
  onBrandChange: (value: string) => void
  onSystemPromptChange: (value: string) => void
  onResetSystemPrompt: () => void
  onNoticeTextChange: (index: number, text: string) => void
  onSelectedIndexChange: (index: number) => void
  onPasteMenu: () => void
  onSubmit: () => void
  onCancel: () => void
  onCopy: (text: string) => void | Promise<void>
}

export function AfternoonTeaNoticeFormView(props: AfternoonTeaNoticeFormViewProps) {
  const locked = props.status === 'running'
  const selectedIndex = resolveAfternoonTeaNoticeSelectedIndex(props.notices, props.selectedIndex)
  const primaryActionLabel = getAfternoonTeaNoticePrimaryActionLabel(props.status, props.notices.length)
  const primaryDisabled = props.status !== 'running' && (!props.configured || !props.menuText.trim())
  const noticeSource = formatAfternoonTeaAnalysisSource(props.sourceChannel, props.sourceModel)
  const copyFlash = useNoticeCopyFlash()

  return (
    <div className="min-w-0 px-0 pt-1 max-lg:pb-[calc(9.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-x-6 lg:pb-7" data-afternoon-tea-notice-workflow aria-label="下午茶通知工作流">
      {!props.configured && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 sm:rounded-md lg:col-span-2">
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
                  className="flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-blue-300"
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
              placeholder={'例如：\n左上蛋黄肉+芝士肉+虾仁肉+牛肉小饼\n右上葱肉+梅干菜肉+榨菜肉\n下蛋黄肉+牛肉+蟹味棒肉\n\n或\n\n套餐A：东坡淋汁豆腐+现磨原味豆浆\n套餐B：豆腐小吃拼盘'}
              className={`min-h-28 resize-y px-4 py-3 text-base leading-relaxed sm:min-h-40 ${toolsMobileFieldClass}`}
              aria-label="菜单输入"
            />
            {props.clipboardError && (
              <div role="alert" className="mt-2 text-sm text-amber-700 dark:text-amber-300">{props.clipboardError}</div>
            )}
          </section>

          <section aria-label="补充信息">
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">补充信息</h2>
            <input
              type="text"
              value={props.brand}
              onChange={(event) => props.onBrandChange(event.target.value)}
              disabled={locked}
              placeholder="例如：汉堡包、奶茶、霸王茶姬"
              className={`min-h-12 px-4 text-base sm:min-h-11 ${toolsMobileFieldClass}`}
              aria-label="补充信息"
            />
          </section>

          <details className="group rounded-2xl border border-gray-200 px-3 py-1 dark:border-white/[0.08] sm:rounded-none sm:border-x-0 sm:border-y sm:px-0 sm:py-2">
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
                className={`resize-y px-4 py-3 text-sm leading-relaxed ${toolsMobileFieldClass}`}
                aria-label="系统提示词"
              />
            </div>
          </details>

          {props.error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 sm:rounded-md">{props.error}</div>
          )}
          <div className="flex items-start justify-between gap-3 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
            <div className="min-w-0">
              <div>{getNoticeStatusLabel(props.status, props.notices.length)}</div>
              {noticeSource && (
                <div className="mt-1 break-all text-gray-700 dark:text-gray-200" aria-label="通知渠道和模型">{noticeSource}</div>
              )}
            </div>
            <span className="shrink-0 tabular-nums">耗时 {formatElapsed(props.elapsed)}</span>
          </div>
        </div>

        <section aria-label="通知文案">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">通知文案</h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {props.notices.length > 0 ? `本次 ${props.notices.length} 张` : `每次 ${AFTERNOON_TEA_NOTICE_RESULT_COUNT} 张`}
            </span>
          </div>
          {props.notices.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:gap-3" role="list">
              {props.notices.map((notice, index) => {
                const selected = index === selectedIndex
                const canCopy = !locked && Boolean(notice.text.trim())
                return (
                  <button
                    key={noticeCopyFlashKey(index)}
                    type="button"
                    role="listitem"
                    onClick={() => {
                      props.onSelectedIndexChange(index)
                      if (!canCopy) return
                      void Promise.resolve(props.onCopy(notice.text)).then(() => {
                        copyFlash.show(noticeCopyFlashKey(index), 'success')
                      }).catch(() => {
                        copyFlash.show(noticeCopyFlashKey(index), 'error')
                      })
                    }}
                    disabled={!canCopy}
                    className={`relative flex min-h-0 flex-col rounded-2xl border px-2.5 py-2.5 text-left shadow-sm transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 enabled:cursor-pointer enabled:active:scale-[0.98] disabled:cursor-not-allowed sm:rounded-xl sm:px-3 sm:py-3 sm:shadow-none ${selected
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
                    <NoticeCopyFlash status={copyFlash.flash?.key === noticeCopyFlashKey(index) ? copyFlash.flash.status : null} />
                    <pre className="min-h-24 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-gray-700 dark:text-gray-200">{notice.text}</pre>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 px-4 text-center text-sm text-gray-500 dark:border-white/[0.12] dark:bg-white/[0.02] dark:text-gray-400 sm:rounded-xl">
              {locked ? `正在生成 ${AFTERNOON_TEA_NOTICE_RESULT_COUNT} 张菜单卡…` : `生成后给出 ${AFTERNOON_TEA_NOTICE_RESULT_COUNT} 张菜单卡，菜品相同，开场和收尾不同`}
            </div>
          )}
        </section>
      </div>

      <div className={TOOLS_MOBILE_ACTION_DOCK_CLASS} aria-label="工作流主操作">
        {props.status === 'running' ? (
          <button
            type="button"
            onClick={props.onCancel}
            className="min-h-12 w-full touch-manipulation rounded-xl border border-gray-200/80 bg-white px-4 text-sm font-medium text-gray-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-[0.98] dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-100 lg:w-auto lg:min-w-56 lg:rounded-md lg:border-gray-300 lg:text-base lg:font-semibold lg:shadow-none"
            aria-label="取消生成"
          >
            {primaryActionLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={primaryDisabled}
            className={toolsMobilePrimaryButtonClass}
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
  const [sourceChannel, setSourceChannel] = useState(draft.sourceChannel)
  const [sourceModel, setSourceModel] = useState(draft.sourceModel)
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
    writeAfternoonTeaNoticeDraft({ menuText, brand, notices, selectedIndex, sourceChannel, sourceModel })
  }, [hydrated, menuText, brand, notices, selectedIndex, sourceChannel, sourceModel])

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
      throw err
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
    setSourceChannel(profile.name.trim())
    setSourceModel(profile.understandingModel.trim())
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = Date.now()
    setRunStartedAt(startedAt)
    setFinishedElapsed(null)
    setStatus('running')
    setError('')
    setNow(startedAt)

    try {
      const result = await runAfternoonTeaNotice({
        menuText,
        supplement: brand,
        systemPrompt,
        profile,
        signal: controller.signal,
      })
      setNotices(result.notices)
      setSourceChannel(result.sourceChannel)
      setSourceModel(result.sourceModel)
      setSelectedIndex(0)
      setStatus('success')
      setFinishedElapsed(result.elapsed)
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
      sourceChannel={sourceChannel}
      sourceModel={sourceModel}
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
