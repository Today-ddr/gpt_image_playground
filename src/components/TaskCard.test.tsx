import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import TaskCard from './TaskCard'

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
    retryTask: () => {},
  }
})

function renderTask(overrides: Partial<TaskRecord> = {}) {
  const task: TaskRecord = {
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

  return renderToStaticMarkup(
    <TaskCard
      task={task}
      onReuse={() => {}}
      onEditOutputs={() => {}}
      onDelete={() => {}}
      onClick={() => {}}
    />,
  )
}

function getParamBarHtml(html: string) {
  const start = html.indexOf('flex overflow-x-auto hide-scrollbar pt-0.5 gap-1.5 whitespace-nowrap mask-edge-r min-w-0 pr-2')
  const end = html.indexOf('flex items-center gap-1 flex-shrink-0 mt-0.5 ml-auto', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return html.slice(start, end)
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
