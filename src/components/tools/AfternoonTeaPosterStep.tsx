export type AfternoonTeaPosterViewItem = {
  id: string
  title: string
  prompt: string
  status: 'queued' | 'running' | 'done' | 'error'
  hasOutput?: boolean
  outputSrc?: string
  error?: string
}

type AfternoonTeaPosterStepProps = {
  sourceImageSrc: string
  sourceImageName: string
  profileName: string
  modelName: string
  items: AfternoonTeaPosterViewItem[]
  busy: boolean
  batchStarted: boolean
  pageError: string
  onStart: () => void
  onBack: () => void
  onClear: () => void
  onReparse: () => void
  onRetry: (itemId: string) => void
}

export function getAfternoonTeaPosterErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return '图片任务创建失败'
  const message = error.message.trim()
  return message ? message.slice(0, 160) : '图片任务创建失败'
}

export function AfternoonTeaPosterStep(props: AfternoonTeaPosterStepProps) {
  const counters = props.items.reduce((result, item) => ({
    ...result,
    [item.status]: result[item.status] + 1,
  }), { queued: 0, running: 0, done: 0, error: 0 })
  const startDisabled = props.busy || props.batchStarted || !props.sourceImageSrc || props.items.length === 0
  const startText = props.busy ? '批次生成中' : props.batchStarted ? '已开始生成' : '开始批量生成'

  return (
    <div className="min-w-0 flex-1 px-0 py-5 sm:px-6 sm:py-7">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">批量海报</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">每个标题生成一张基于原图的下午茶海报</p>
        </div>
        <button type="button" onClick={props.onBack} disabled={props.busy} className="whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">
          返回订单解析
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4" aria-label="批量海报输入摘要">
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]">
            <div className="border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-white/[0.08] dark:text-gray-200">原图</div>
            {props.sourceImageSrc ? (
              <>
                <img src={props.sourceImageSrc} alt="下午茶海报原图" className="aspect-[4/3] w-full bg-gray-50 object-contain dark:bg-black/20" />
                <div className="truncate px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{props.sourceImageName || '已上传图片'}</div>
              </>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center px-4 text-center text-sm text-amber-700 dark:text-amber-300">请先上传原图</div>
            )}
          </section>

          <section className="rounded-md border border-gray-200 bg-gray-50/60 px-3 py-3 dark:border-white/[0.08] dark:bg-white/[0.02]" aria-label="图片模型摘要">
            <div className="text-xs text-gray-500 dark:text-gray-400">图片配置</div>
            <div className="mt-1 break-words text-sm font-medium text-gray-800 dark:text-gray-100">{props.profileName || '未配置'}</div>
            <div className="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400">{props.modelName || '未配置图片模型'}</div>
          </section>

          <section aria-label="海报 Prompt" className="space-y-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Prompt 预览</div>
            {props.items.map((item) => (
              <details key={item.id} className="rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <summary className="cursor-pointer break-words text-sm font-medium text-gray-700 dark:text-gray-200">{item.title}</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-gray-500 dark:text-gray-400">{item.prompt}</pre>
              </details>
            ))}
          </section>

          {props.pageError && (
            <div role="alert" className="break-words rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              {props.pageError}
            </div>
          )}

          {!props.sourceImageSrc && <div className="text-xs text-amber-700 dark:text-amber-300">批量生成需要一张原图。</div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={props.onStart} disabled={startDisabled} className="whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {startText}
            </button>
            <button type="button" onClick={props.onReparse} disabled={props.busy} className="whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">
              重新解析
            </button>
            <button type="button" onClick={props.onClear} disabled={props.busy} className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/[0.06]">
              清空
            </button>
          </div>
        </aside>

        <section className="min-w-0" aria-label="批量海报结果">
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
            <span>总数 {props.items.length}</span>
            <span>等待 {counters.queued}</span>
            <span>生成中 {counters.running}</span>
            <span>成功 {counters.done}</span>
            <span>失败 {counters.error}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {props.items.map((item) => (
              <article key={item.id} data-result-slot={item.id} className="min-w-0 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]">
                <div className="relative aspect-[4/3] min-h-[180px] bg-gray-50 dark:bg-black/20">
                  {item.status === 'done' && item.outputSrc ? (
                    <img src={item.outputSrc} alt={`${item.title}海报`} className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full min-h-[180px] items-center justify-center px-4 text-center text-sm text-gray-400">
                      {item.status === 'running' ? '正在生成...' : item.status === 'error' ? '生成失败' : item.status === 'done' ? item.hasOutput === false ? '没有输出图片' : '正在加载图片...' : '等待生成'}
                    </div>
                  )}
                </div>
                <div className="min-h-[76px] border-t border-gray-200 px-3 py-2.5 dark:border-white/[0.08]">
                  <div className="break-words text-sm font-medium text-gray-800 dark:text-gray-100">{item.title}</div>
                  {item.status === 'error' && (
                    <div className="mt-2 space-y-2">
                      <p className="max-h-20 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-red-600 dark:text-red-300">{item.error || '图片任务创建失败'}</p>
                      <button type="button" onClick={() => props.onRetry(item.id)} disabled={props.busy} className="whitespace-nowrap rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:bg-white/[0.03] dark:text-red-300 dark:hover:bg-red-500/10">
                        重试此项
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
