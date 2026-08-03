import { useEffect, useState } from 'react'
import type { TaskRecord } from '../../types'
import TaskCard from '../TaskCard'

export type AfternoonTeaPosterViewSlot = {
  taskId?: string
  task?: TaskRecord
  status: 'queued' | 'running' | 'done' | 'error'
  profileName?: string
  error?: string
}

export type AfternoonTeaPosterViewItem = {
  id: string
  title: string
  prompt: string
  status: 'queued' | 'running' | 'done' | 'error'
  task?: TaskRecord
  /** 多中转站并行时每个配置一列 */
  slots?: AfternoonTeaPosterViewSlot[]
  error?: string
}

type AfternoonTeaPosterStepProps = {
  sourceImageSrc: string
  items: AfternoonTeaPosterViewItem[]
  busy: boolean
  batchStartedAt: number | null
  batchFinishedAt: number | null
  retryDisabled?: boolean
  pageError: string
  onStart: () => void
  onBack: () => void
  onClear: () => void
  onReparse: () => void
  onRetry: (itemId: string, taskId?: string) => void
  onTaskClick?: (task: TaskRecord) => void
  onTaskDelete?: (task: TaskRecord) => void
  onTaskReuse?: (task: TaskRecord) => void
  onTaskEditOutputs?: (task: TaskRecord) => void
}

export function getAfternoonTeaPosterErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return '图片任务创建失败'
  const message = error.message.trim()
  return message ? message.slice(0, 160) : '图片任务创建失败'
}

export function AfternoonTeaPosterStep(props: AfternoonTeaPosterStepProps) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (props.batchStartedAt == null || props.batchFinishedAt != null) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [props.batchStartedAt, props.batchFinishedAt])
  const resultSlots = props.items.flatMap((item) => {
    if (item.slots && item.slots.length) {
      return item.slots.map((slot, slotIndex) => ({
        key: slot.taskId || `${item.id}-slot-${slotIndex}`,
        itemId: item.id,
        title: item.title,
        status: slot.status,
        task: slot.task,
        error: slot.error || item.error,
        profileName: slot.profileName,
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
  const counters = resultSlots.reduce((result, slot) => ({
    ...result,
    [slot.status]: result[slot.status] + 1,
  }), { queued: 0, running: 0, done: 0, error: 0 })
  const startDisabled = props.busy || props.batchStartedAt != null || !props.sourceImageSrc || props.items.length === 0
  const startText = props.busy ? '批次生成中' : props.batchStartedAt != null ? '已开始生成' : '开始批量生成'
  const elapsedSeconds = props.batchStartedAt == null
    ? null
    : Math.floor(Math.max(0, (props.batchFinishedAt ?? now) - props.batchStartedAt) / 1_000)
  const elapsedText = elapsedSeconds == null
    ? '--:--'
    : `${Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`

  return (
    <div className="min-w-0 flex-1 px-0 py-4 sm:px-6 sm:py-7">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">批量海报</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">每个标题生成一张基于原图的下午茶海报</p>
        </div>
        <button type="button" onClick={props.onBack} disabled={props.busy} className="hidden whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08] sm:inline-flex">
          返回订单解析
        </button>
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-4" aria-label="批量海报输入摘要">
          <section className="min-w-0 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]" aria-label="下午茶海报原图">
            <div className="border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-white/[0.08] dark:text-gray-200">原图预览</div>
            {props.sourceImageSrc ? (
              <div className="flex max-h-[45svh] min-w-0 items-center justify-center overflow-hidden bg-gray-50 p-2 dark:bg-black/20 lg:max-h-none">
                <img src={props.sourceImageSrc} alt="下午茶海报原图" className="block h-auto max-h-[calc(45svh_-_1rem)] w-auto max-w-full object-contain lg:max-h-none lg:w-full" />
              </div>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center px-4 text-center text-sm text-amber-700 dark:text-amber-300">请先上传原图</div>
            )}
          </section>

          {props.pageError && (
            <div role="alert" className="break-words rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              {props.pageError}
            </div>
          )}

          {!props.sourceImageSrc && <div className="text-xs text-amber-700 dark:text-amber-300">批量生成需要一张原图。</div>}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button type="button" onClick={props.onStart} disabled={startDisabled} className="col-span-2 min-h-11 whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:col-auto sm:min-h-0">
              {startText}
            </button>
            <button type="button" onClick={props.onReparse} disabled={props.busy} className="min-h-11 whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08] sm:min-h-0">
              重新解析
            </button>
            <button type="button" onClick={props.onClear} disabled={props.busy} className="min-h-11 whitespace-nowrap rounded-md px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/[0.06] sm:min-h-0">
              清空
            </button>
          </div>

          <section aria-label="海报 Prompt" className="space-y-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Prompt 预览</div>
            {props.items.map((item) => (
              <details key={item.id} className="rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <summary className="flex min-h-11 cursor-pointer items-center break-words text-sm font-medium text-gray-700 dark:text-gray-200 sm:min-h-0">{item.title}</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-gray-500 dark:text-gray-400">{item.prompt}</pre>
              </details>
            ))}
          </section>
        </aside>

        <section className="min-w-0" aria-label="批量海报结果">
          <div className="mb-3 grid grid-cols-3 gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400 sm:flex sm:flex-wrap sm:gap-x-4" aria-live="polite">
            <span>总数 {resultSlots.length}</span>
            <span>等待 {counters.queued}</span>
            <span>生成中 {counters.running}</span>
            <span>成功 {counters.done}</span>
            <span>失败 {counters.error}</span>
            <span>总耗时 {elapsedText}</span>
          </div>

          <div data-generate-result-grid className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr))]">
            {resultSlots.map((slot) => slot.task ? (
              <div key={slot.key} data-result-slot={slot.itemId} data-task-card={slot.task.id} className="min-w-0">
                <TaskCard
                  task={slot.task}
                  disableSwipe
                  retryDisabled={props.busy || Boolean(props.retryDisabled)}
                  onClick={() => props.onTaskClick?.(slot.task!)}
                  onDelete={() => props.onTaskDelete?.(slot.task!)}
                  onReuse={() => props.onTaskReuse?.(slot.task!)}
                  onEditOutputs={() => props.onTaskEditOutputs?.(slot.task!)}
                  onRetry={() => props.onRetry(slot.itemId, slot.task?.id)}
                />
              </div>
            ) : (
              <article key={slot.key} data-result-slot={slot.itemId} data-result-placeholder className="flex min-h-40 min-w-0 flex-col justify-between rounded-md border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <div>
                  <div className="break-words text-sm font-medium text-gray-800 dark:text-gray-100">{slot.title}</div>
                  {slot.profileName && (
                    <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{slot.profileName}</div>
                  )}
                  <div className="mt-3 text-sm text-gray-400">
                    {slot.status === 'queued' ? '等待生成' : slot.error || '任务记录不可用'}
                  </div>
                </div>
                {slot.status === 'error' && (
                  <button type="button" onClick={() => props.onRetry(slot.itemId, slot.task?.id)} disabled={props.busy || Boolean(props.retryDisabled)} className="mt-3 min-h-11 w-full self-stretch whitespace-nowrap rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:bg-white/[0.03] dark:text-red-300 dark:hover:bg-red-500/10 sm:min-h-0 sm:w-auto sm:self-start">
                    重试此项
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
