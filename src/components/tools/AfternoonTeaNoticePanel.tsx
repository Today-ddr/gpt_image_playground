import { useEffect, useRef, useState } from 'react'
import {
  resolveAfternoonTeaNoticeSelectedIndex,
  type AfternoonTeaNotice,
  type AfternoonTeaNoticeStatus,
} from '../../lib/afternoonTeaNotice'
import { diffAfternoonTeaNotice } from '../../lib/afternoonTeaNoticeDiff'
import { CopyIcon } from '../icons'

function formatNoticeSource(channel: string, model: string) {
  const parts = []
  const trimmedChannel = channel.trim()
  const trimmedModel = model.trim()
  if (trimmedChannel) parts.push(`渠道 ${trimmedChannel}`)
  if (trimmedModel) parts.push(`模型 ${trimmedModel}`)
  return parts.join(' · ')
}

type AfternoonTeaNoticePanelProps = {
  status: AfternoonTeaNoticeStatus
  notices: AfternoonTeaNotice[]
  error: string
  elapsed: number | null
  channel: string
  model: string
  onCopy: (text: string) => void | Promise<void>
}

export function useNoticeCopyFlash() {
  const [flash, setFlash] = useState<{ key: string; status: 'success' | 'error' } | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current)
  }, [])

  const show = (key: string, status: 'success' | 'error') => {
    if (timer.current != null) window.clearTimeout(timer.current)
    setFlash({ key, status })
    timer.current = window.setTimeout(() => setFlash(null), 1100)
  }

  return { flash, show }
}

export function NoticeCopyFlash(props: { status: 'success' | 'error' | null }) {
  if (!props.status) return null
  const ok = props.status === 'success'
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl text-sm font-semibold text-white ${ok ? 'notice-copy-ok bg-emerald-600/90' : 'notice-copy-fail bg-red-600/90'}`}
      role="status"
    >
      {ok ? '已复制' : '复制失败'}
    </div>
  )
}

function formatElapsed(value: number | null) {
  if (value == null) return '--:--'
  const seconds = Math.floor(Math.max(0, value) / 1_000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function statusLabel(status: AfternoonTeaNoticeStatus, noticeCount: number) {
  if (status === 'running') return '正在生成通知'
  if (status === 'success' || noticeCount > 0) return '已生成，可挑选复制'
  if (status === 'error') return '通知生成失败'
  if (status === 'cancelled') return '通知已取消'
  return ''
}

export function AfternoonTeaNoticePanel(props: AfternoonTeaNoticePanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const copyFlash = useNoticeCopyFlash()
  const source = formatNoticeSource(props.channel, props.model)
  const visible = props.status !== 'idle' || props.notices.length > 0 || Boolean(props.error)
  if (!visible) return null
  const selected = resolveAfternoonTeaNoticeSelectedIndex(props.notices, selectedIndex)

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-white/[0.03] sm:rounded-md" aria-label="下午茶通知">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">下午茶通知</h2>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{statusLabel(props.status, props.notices.length)}</div>
          {source && (
            <div className="mt-1 break-all text-xs text-gray-700 dark:text-gray-200" aria-label="通知渠道和模型">{source}</div>
          )}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">耗时 {formatElapsed(props.elapsed)}</span>
      </div>
      {props.error && (
        <div role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{props.error}</div>
      )}
      {props.status === 'running' && props.notices.length === 0 && (
        <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 dark:border-white/[0.12] dark:text-gray-400">正在生成 4 张菜单卡…</div>
      )}
      {props.notices.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" role="list">
          {props.notices.map((notice, index) => {
            const active = index === selected
            const baseline = props.notices[0]?.text ?? ''
            const diff = index === 0 ? null : diffAfternoonTeaNotice(baseline, notice.text)
            const diffLabel = diff == null
              ? '基准'
              : diff.parts.length > 0
                ? `相较基准：${diff.parts.join('、')}`
                : '和基准相同'
            return (
              <button
                key={`${notice.style}-${index}`}
                type="button"
                role="listitem"
                onClick={() => {
                  setSelectedIndex(index)
                  if (!notice.text.trim()) return
                  void Promise.resolve(props.onCopy(notice.text)).then(() => {
                    copyFlash.show(String(index), 'success')
                  }).catch(() => {
                    copyFlash.show(String(index), 'error')
                  })
                }}
                className={`notice-card-rise relative touch-manipulation rounded-xl border px-2.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-[0.99] ${active ? 'border-blue-300 bg-blue-50/70 ring-2 ring-inset ring-blue-400 dark:border-blue-500/40 dark:bg-blue-500/10 dark:ring-blue-500/60' : 'border-gray-200 bg-white dark:border-white/[0.1] dark:bg-white/[0.03]'}`}
                style={{ animationDelay: `${index * 80}ms` }}
                aria-label={`复制${notice.style}通知`}
              >
                <div className="mb-2 flex items-center justify-between gap-1.5">
                  <span className={`inline-flex max-w-[70%] truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'}`}>{notice.style}</span>
                  <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] ${active ? 'text-blue-600 dark:text-blue-300' : 'text-gray-400'}`}>
                    <CopyIcon className="h-3.5 w-3.5" />
                    点击复制
                  </span>
                </div>
                <div className={`mb-2 text-[11px] font-medium ${index === 0 ? 'text-gray-500 dark:text-gray-400' : 'text-amber-700 dark:text-amber-300'}`} data-notice-diff={diffLabel}>{diffLabel}</div>
                <NoticeCopyFlash status={copyFlash.flash?.key === String(index) ? copyFlash.flash.status : null} />
                <div className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-gray-700 dark:text-gray-200">
                  {(diff?.lines ?? notice.text.split('\n').map((text) => ({ text, changed: false }))).map((line, lineIndex) => (
                    <div key={`${index}-${lineIndex}`} data-changed={line.changed ? 'true' : undefined} className={line.changed ? 'rounded bg-amber-100 px-1 text-amber-950 dark:bg-amber-400/15 dark:text-amber-100' : undefined}>
                      {line.text || '\u00a0'}
                    </div>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
