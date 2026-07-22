import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../../types'
import {
  AfternoonTeaPosterStep,
  getAfternoonTeaPosterErrorMessage,
  type AfternoonTeaPosterViewItem,
} from './AfternoonTeaPosterStep'
import posterStepSource from './AfternoonTeaPosterStep.tsx?raw'
import workspaceSource from '../ToolsWorkspace.tsx?raw'

const taskCardProps = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('../TaskCard', () => ({
  default: (props: Record<string, unknown>) => {
    taskCardProps.push(props)
    return <div data-mocked-task-card />
  },
}))

const noop = () => {}

const task: TaskRecord = {
  id: 'task-done',
  prompt: '午后茶歇 prompt',
  params: {
    size: 'auto', quality: 'auto', output_format: 'png', output_compression: null,
    moderation: 'auto', n: 1, transparent_output: false,
  },
  inputImageIds: [], outputImages: ['image-a'], status: 'done', error: null,
  createdAt: 100, finishedAt: 65_500, elapsed: 1,
}

const items: AfternoonTeaPosterViewItem[] = [
  { id: 'queued-1', title: '午后茶歇', prompt: '午后茶歇 prompt', status: 'queued' },
  { id: 'running-1', title: '暖心时光', prompt: '暖心时光 prompt', status: 'running' },
  { id: 'done-1', title: '轻松一刻', prompt: '轻松一刻 prompt', status: 'done', task },
  { id: 'error-1', title: '惬意茶点', prompt: '惬意茶点 prompt', status: 'error', error: '请求失败，请稍后重试' },
  { id: 'queued-2', title: '茶香满室', prompt: '茶香满室 prompt', status: 'queued' },
]

function renderStep(overrides: Partial<Parameters<typeof AfternoonTeaPosterStep>[0]> = {}) {
  taskCardProps.length = 0
  return renderToStaticMarkup(<AfternoonTeaPosterStep
    sourceImageSrc="data:image/png;base64,AQID"
    items={items}
    busy={false}
    batchStartedAt={500}
    batchFinishedAt={65_500}
    pageError=""
    onStart={noop}
    onBack={noop}
    onClear={noop}
    onReparse={noop}
    onRetry={noop}
    {...overrides}
  />)
}

describe('AfternoonTeaPosterStep', () => {
  it('shows source image without its filename and keeps prompt previews collapsed', () => {
    const html = renderStep()
    expect(html).toContain('alt="下午茶海报原图"')
    expect(html).not.toContain('tea.png')
    expect(html).not.toContain('truncate px-3 py-2')
    expect(html).not.toContain('图片配置')
    expect(html).toContain('<details')
    expect(html).toContain('午后茶歇')
    expect(html).toContain('午后茶歇 prompt')
    expect(html).not.toContain('<textarea')
  })

  it('does not expose the source filename through poster view props', () => {
    const propsSource = posterStepSource.slice(
      posterStepSource.indexOf('type AfternoonTeaPosterStepProps = {'),
      posterStepSource.indexOf('export function getAfternoonTeaPosterErrorMessage'),
    )
    const callStart = workspaceSource.indexOf('<AfternoonTeaPosterStep')
    const callSource = workspaceSource.slice(callStart, workspaceSource.indexOf('/>', callStart) + 2)

    expect(propsSource).not.toContain('sourceImageName')
    expect(callSource).not.toContain('sourceImageName')
  })

  it('renders one stable result slot per title and all summary counters', () => {
    const html = renderStep()
    expect((html.match(/data-result-slot=/g) ?? [])).toHaveLength(5)
    expect(html).toContain('总数 5')
    expect(html).toContain('等待 2')
    expect(html).toContain('生成中 1')
    expect(html).toContain('成功 1')
    expect(html).toContain('失败 1')
    expect(html).toContain('aspect-[')
  })

  it('keeps poster controls and counters stable on narrow screens', () => {
    const html = renderStep({ batchStartedAt: null, batchFinishedAt: null })

    expect(html).toContain('py-4 sm:px-6 sm:py-7')
    expect(html).toContain('grid grid-cols-2 gap-2 sm:flex')
    expect(html).toContain('col-span-2')
    expect(html).toContain('sm:col-auto')
    expect(html).toContain('grid grid-cols-3')
    expect(html).toMatch(/<button[^>]*class="[^"]*hidden[^"]*sm:inline-flex[^"]*"[^>]*>返回订单解析<\/button>/)
  })

  it('renders completed output with its title and a safe retryable error slot', () => {
    const html = renderStep()
    expect(html).toContain('data-task-card="task-done"')
    expect(html).toContain('轻松一刻')
    expect(html).toContain('请求失败，请稍后重试')
    expect(html).toContain('重试此项')
  })

  it('does not fabricate an image when a completed task has no output', () => {
    const html = renderStep({
      items: [{ id: 'done-empty', title: '无图结果', prompt: 'prompt', status: 'done' }],
    })
    expect(html).toContain('任务记录不可用')
  })

  it('disables start without a source image and explains the requirement', () => {
    const html = renderStep({ sourceImageSrc: '', batchStartedAt: null, batchFinishedAt: null })
    expect(html).toContain('请先上传原图')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>开始批量生成<\/button>/)
  })

  it('locks navigation, reset, retry, and duplicate submission while running', () => {
    const html = renderStep({ busy: true, retryDisabled: false })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>返回订单解析<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>重新解析<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>清空<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>重试此项<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>批次生成中<\/button>/)
  })

  it('keeps duplicate submission disabled after a batch has started', () => {
    const html = renderStep({ busy: false, batchStartedAt: 500 })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>已开始生成<\/button>/)
  })

  it('shows frozen wall-clock batch elapsed and a placeholder before start', () => {
    const html = renderStep()
    expect(html).toContain('总耗时 01:05')
    expect(renderStep({ batchStartedAt: null, batchFinishedAt: null })).toContain('总耗时 --:--')
  })

  it('passes disableSwipe, custom retry, retryDisabled, and task actions to TaskCard', () => {
    const calls: string[] = []
    renderStep({
      retryDisabled: true,
      onRetry: (itemId) => calls.push(`retry:${itemId}`),
      onTaskClick: (value) => calls.push(`click:${value.id}`),
      onTaskDelete: (value) => calls.push(`delete:${value.id}`),
      onTaskReuse: (value) => calls.push(`reuse:${value.id}`),
      onTaskEditOutputs: (value) => calls.push(`edit:${value.id}`),
    })
    const props = taskCardProps[0] as {
      disableSwipe: boolean
      retryDisabled: boolean
      onRetry: () => void
      onClick: () => void
      onDelete: () => void
      onReuse: () => void
      onEditOutputs: () => void
    }
    expect(props).toMatchObject({ disableSwipe: true, retryDisabled: true })
    props.onRetry()
    props.onClick()
    props.onDelete()
    props.onReuse()
    props.onEditOutputs()
    expect(calls).toEqual(['retry:done-1', 'click:task-done', 'delete:task-done', 'reuse:task-done', 'edit:task-done'])
  })

  it('limits setup errors and uses a fixed message for non-errors', () => {
    expect(getAfternoonTeaPosterErrorMessage({ apiKey: 'secret' })).toBe('图片任务创建失败')
    const message = getAfternoonTeaPosterErrorMessage(new Error(`创建失败${'很'.repeat(300)}`))
    expect(message.startsWith('创建失败')).toBe(true)
    expect(message.length).toBeLessThanOrEqual(160)
  })
})
