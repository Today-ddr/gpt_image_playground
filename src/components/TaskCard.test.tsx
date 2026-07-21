import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import TaskCard from './TaskCard'

const { retryTaskMock } = vi.hoisted(() => ({
  retryTaskMock: vi.fn(),
}))

type MockStoreState = {
  toggleTaskSelection: () => void
  settings: { alwaysShowRetryButton: boolean }
  openFavoritePicker: () => void
  streamPreviews: Record<string, string>
}

vi.mock('../store', () => {
  const state: MockStoreState = {
    toggleTaskSelection: () => {},
    settings: { alwaysShowRetryButton: false },
    openFavoritePicker: () => {},
    streamPreviews: {},
  }

  return {
    useStore: (selector: (state: MockStoreState) => unknown) => selector(state),
    ensureImageThumbnailCached: async () => null,
    subscribeImageThumbnail: () => () => {},
    retryTask: retryTaskMock,
  }
})

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: '画一张图',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 65_001,
    elapsed: 65_000,
    ...overrides,
  }
}

function renderTaskRecord(
  task: TaskRecord,
  props: Pick<ComponentProps<typeof TaskCard>, 'onRetry' | 'retryDisabled'> = {},
) {
  return renderToStaticMarkup(
    <TaskCard
      task={task}
      onReuse={() => {}}
      onEditOutputs={() => {}}
      onDelete={() => {}}
      onClick={() => {}}
      {...props}
    />,
  )
}

function renderTask(overrides: Partial<TaskRecord> = {}) {
  return renderTaskRecord(createTask(overrides))
}

type RetryButtonProps = {
  tooltip?: string
  disabled?: boolean
  onClick?: () => void
  children?: ReactNode
}

function findRetryButton(node: ReactNode): ReactElement<RetryButtonProps> | null {
  if (!isValidElement(node)) return null
  const props = node.props as RetryButtonProps
  if (props.tooltip === '重试任务') return node as ReactElement<RetryButtonProps>

  for (const child of Children.toArray(props.children)) {
    const button = findRetryButton(child)
    if (button) return button
  }
  return null
}

async function getRetryButton(
  task: TaskRecord,
  props: Pick<ComponentProps<typeof TaskCard>, 'onRetry' | 'retryDisabled'> = {},
) {
  vi.resetModules()
  vi.doMock('react', async (importOriginal) => {
    const react = await importOriginal<typeof import('react')>()
    return {
      ...react,
      useEffect: () => {},
      useRef: (initial: unknown) => ({ current: initial }),
      useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
    }
  })

  try {
    const { default: TaskCardWithoutEffects } = await import('./TaskCard')
    return findRetryButton(TaskCardWithoutEffects({
      task,
      onReuse: () => {},
      onEditOutputs: () => {},
      onDelete: () => {},
      onClick: () => {},
      ...props,
    }))
  } finally {
    vi.doUnmock('react')
    vi.resetModules()
  }
}

function getParamBarHtml(html: string) {
  const start = html.indexOf('flex overflow-x-auto hide-scrollbar pt-0.5 gap-1.5 whitespace-nowrap mask-edge-r min-w-0 pr-2')
  const end = html.indexOf('flex items-center gap-1 flex-shrink-0 mt-0.5 ml-auto', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return html.slice(start, end)
}

function getCompactSummaryHtml(html: string) {
  const marker = '<p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">'
  const start = html.indexOf(marker)
  const end = html.indexOf('</p>', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return html.slice(start + marker.length, end)
}

function getActionButtonHtml(html: string, label: string) {
  const labelIndex = html.indexOf(`aria-label="${label}"`)
  const start = html.lastIndexOf('<button', labelIndex)
  const end = html.indexOf('</button>', labelIndex)
  expect(labelIndex).toBeGreaterThan(-1)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(labelIndex)
  return html.slice(start, end + '</button>'.length)
}

describe('TaskCard elapsed time', () => {
  it('shows the final elapsed time first and hides the API channel', () => {
    const paramBarHtml = getParamBarHtml(renderTask({
      apiProfileName: '测试渠道',
      apiModel: 'custom-model',
    }))

    expect(paramBarHtml).toContain('耗时')
    expect(paramBarHtml).toContain('01:05')
    expect(paramBarHtml).not.toContain('测试渠道')
    expect(paramBarHtml.indexOf('耗时')).toBeLessThan(paramBarHtml.indexOf('custom-model'))
  })

  it('does not show elapsed time in the parameter bar while running', () => {
    const paramBarHtml = getParamBarHtml(renderTask({
      status: 'running',
      finishedAt: null,
    }))

    expect(paramBarHtml).not.toContain('耗时')
  })

  it('does not show elapsed time for completed legacy tasks without it', () => {
    const paramBarHtml = getParamBarHtml(renderTask({ elapsed: null }))

    expect(paramBarHtml).not.toContain('耗时')
  })
})

describe('TaskCard retry contract', () => {
  it('uses the custom retry action instead of the default retry action', async () => {
    retryTaskMock.mockClear()
    const task = createTask({ status: 'error', error: '生成失败' })
    const onRetry = vi.fn()
    const button = await getRetryButton(task, { onRetry })

    expect(button).not.toBeNull()
    button?.props.onClick?.()
    expect(onRetry).toHaveBeenCalledWith(task)
    expect(retryTaskMock).not.toHaveBeenCalled()
  })

  it('keeps the default retry action when no custom action is provided', async () => {
    retryTaskMock.mockClear()
    const task = createTask({ status: 'error', error: '生成失败' })
    const button = await getRetryButton(task)

    expect(button).not.toBeNull()
    button?.props.onClick?.()
    expect(retryTaskMock).toHaveBeenCalledWith(task)
  })

  it('disables custom retry without invoking it', async () => {
    retryTaskMock.mockClear()
    const task = createTask({ status: 'error', error: '生成失败' })
    const onRetry = vi.fn()
    const button = await getRetryButton(task, { onRetry, retryDisabled: true })

    expect(button?.props.disabled).toBe(true)
    button?.props.onClick?.()
    expect(onRetry).not.toHaveBeenCalled()
    expect(retryTaskMock).not.toHaveBeenCalled()
    expect(getActionButtonHtml(
      renderTaskRecord(task, { onRetry, retryDisabled: true }),
      '重试任务',
    )).toContain('disabled=""')
  })

  it('disables default retry without invoking it', async () => {
    retryTaskMock.mockClear()
    const task = createTask({ status: 'error', error: '生成失败' })
    const button = await getRetryButton(task, { retryDisabled: true })

    expect(button?.props.disabled).toBe(true)
    button?.props.onClick?.()
    expect(retryTaskMock).not.toHaveBeenCalled()
  })
})

describe('TaskCard compact summary', () => {
  it('shows the trimmed afternoon tea title without changing the full prompt', () => {
    const task = createTask({
      prompt: '完整的下午茶海报生成提示词',
      afternoonTeaBatchId: 'tea-batch-a',
      afternoonTeaTitle: '  夏日下午茶  ',
    })
    const originalPrompt = task.prompt
    const summaryHtml = getCompactSummaryHtml(renderTaskRecord(task))

    expect(summaryHtml).toBe('夏日下午茶')
    expect(summaryHtml).not.toContain(originalPrompt)
    expect(task.prompt).toBe(originalPrompt)
  })

  it('falls back to the full prompt for a blank afternoon tea title', () => {
    const html = renderTask({
      prompt: '完整的下午茶海报生成提示词',
      afternoonTeaBatchId: 'tea-batch-a',
      afternoonTeaTitle: '   ',
    })

    expect(html).toContain('完整的下午茶海报生成提示词')
  })

  it.each([
    ['Gallery', {}],
    ['Agent', { sourceMode: 'agent' as const, agentConversationId: 'conversation-a' }],
  ])('keeps the full prompt for %s tasks', (_label, overrides) => {
    const html = renderTask({
      prompt: '普通任务完整提示词',
      afternoonTeaTitle: '不应显示的孤立标题',
      ...overrides,
    })

    expect(html).toContain('普通任务完整提示词')
    expect(html).not.toContain('不应显示的孤立标题')
  })
})
