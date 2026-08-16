import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../../types'
import {
  AfternoonTeaMobileWorkflow,
  clampGenerateSplitLeftPercent,
  deriveMobileAfternoonTeaPhase,
  getMobileAfternoonTeaCandidates,
  canReadAfternoonTeaClipboard,
  readAfternoonTeaClipboardText,
  readGenerateSplitLeftPercent,
  resolveMobileAfternoonTeaSelection,
  writeGenerateSplitLeftPercent,
} from './AfternoonTeaMobileWorkflow'
import * as mobileWorkflowHelpers from './AfternoonTeaMobileWorkflow'
import mobileWorkflowSource from './AfternoonTeaMobileWorkflow.tsx?raw'

const noop = () => {}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('react')
  vi.resetModules()
})

function task(id: string, status: TaskRecord['status'], outputImages: string[] = []): TaskRecord {
  return {
    id,
    prompt: `${id} prompt`,
    params: {
      size: 'auto', quality: 'auto', output_format: 'png', output_compression: null,
      moderation: 'auto', n: 1, transparent_output: false,
    },
    inputImageIds: [],
    outputImages,
    status,
    error: status === 'error' ? '生成失败' : null,
    createdAt: 1,
    finishedAt: status === 'running' ? null : 2,
    elapsed: status === 'running' ? null : 1,
  }
}

const orderResult = {
  titles: ['午后茶歇', '暖心时光'],
  items: [
    { displayName: '草莓蛋糕', tags: ['草莓', '奶油'] },
    { displayName: '柠檬红茶', tags: ['红茶'] },
  ],
}

type WorkflowProps = Parameters<typeof AfternoonTeaMobileWorkflow>[0]

function workflowProps(overrides: Partial<WorkflowProps> = {}): WorkflowProps {
  return {
    configured: true,
    imageDataUrl: 'data:image/png;base64,AQID',
    imageLoading: false,
    imageMissing: false,
    userPrompt: '草莓蛋糕和柠檬红茶',
    systemPrompt: '系统提示词',
    titleCount: 2,
    orderResult,
    itemTitleRegions: [
      { x: 0.08, y: 0.1, width: 0.34, height: 0.18 },
      { x: 0.58, y: 0.62, width: 0.34, height: 0.18 },
    ],
    items: [],
    error: '',
    pageError: '',
    analysisStatus: 'success',
    analysisElapsed: 1_000,
    batchStartedAt: null,
    batchFinishedAt: null,
    busy: false,
    retryDisabled: false,
    locked: false,
    onImageChange: noop,
    onRemoveImage: noop,
    onUserPromptChange: noop,
    onSystemPromptChange: noop,
    onTitleCountChange: noop,
    onResetSystemPrompt: noop,
    onSubmit: noop,
    onCancel: noop,
    onClear: noop,
    onReparse: noop,
    onPosterTitleChange: noop,
    onPosterTitlesChange: noop,
    onItemTitleRegionsChange: noop,
    onItemNameChange: noop,
    onItemTagsChange: noop,
    onConfirmAndGenerate: noop,
    onRetry: noop,
    onTaskClick: noop,
    ...overrides,
  }
}

function renderWorkflow(overrides: Partial<WorkflowProps> = {}) {
  return renderToStaticMarkup(<AfternoonTeaMobileWorkflow {...workflowProps(overrides)} />)
}

function classForLabel(html: string, label: string) {
  const labelIndex = html.indexOf(`aria-label="${label}"`)
  if (labelIndex < 0) return ''
  const tag = html.slice(html.lastIndexOf('<', labelIndex), html.indexOf('>', labelIndex) + 1)
  return tag.match(/class="([^"]*)"/)?.[1] ?? ''
}

type ElementNode = {
  type?: unknown
  props?: Record<string, unknown> & { children?: unknown }
}

function findElement(node: unknown, predicate: (element: ElementNode) => boolean): ElementNode | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate)
      if (match) return match
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  const element = node as ElementNode
  if (predicate(element)) return element
  return findElement(element.props?.children, predicate)
}

function elementByLabel(tree: unknown, label: string) {
  const element = findElement(tree, (candidate) => candidate.props?.['aria-label'] === label)
  expect(element, `missing element with aria-label ${label}`).not.toBeNull()
  return element as ElementNode & { props: Record<string, unknown> & { children?: unknown } }
}

function elementText(node: unknown): string {
  if (Array.isArray(node)) return node.map(elementText).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  return elementText((node as ElementNode).props?.children)
}

function callHandler(element: ElementNode, name: string, event?: unknown) {
  const handler = element.props?.[name]
  expect(handler, `missing ${name} handler`).toBeTypeOf('function')
  return (handler as (value?: unknown) => unknown)(event)
}

async function createWorkflowHookDriver(overrides: Partial<WorkflowProps> = {}) {
  const states: unknown[] = []
  const refs: Array<{ current: unknown }> = []
  let stateCursor = 0
  let refCursor = 0

  vi.resetModules()
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react')
    return {
      ...actual,
      useCallback: <T,>(value: T) => value,
      useEffect: () => undefined,
      useMemo: <T,>(factory: () => T) => factory(),
      useRef: <T,>(initial: T) => {
        const index = refCursor++
        refs[index] ??= { current: initial }
        return refs[index] as { current: T }
      },
      useState: <T,>(initial: T | (() => T)) => {
        const index = stateCursor++
        if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => T)() : initial
        const setState = (value: T | ((current: T) => T)) => {
          states[index] = typeof value === 'function'
            ? (value as (current: T) => T)(states[index] as T)
            : value
        }
        return [states[index] as T, setState] as const
      },
    }
  })
  const workflowModule = await import('./AfternoonTeaMobileWorkflow')
  const props = workflowProps(overrides)

  return {
    render: () => {
      stateCursor = 0
      refCursor = 0
      return workflowModule.AfternoonTeaMobileWorkflow(props)
    },
  }
}

describe('deriveMobileAfternoonTeaPhase', () => {
  it.each([
    ['blank input', { orderResult: null, analysisStatus: 'idle', batchStartedAt: null, batchFinishedAt: null }, 'input'],
    ['analysis in place', { orderResult: null, analysisStatus: 'running', batchStartedAt: null, batchFinishedAt: null }, 'analyzing'],
    ['parsed review', { orderResult, analysisStatus: 'success', batchStartedAt: null, batchFinishedAt: null }, 'review'],
    ['batch generation', { orderResult, analysisStatus: 'success', batchStartedAt: 10, batchFinishedAt: null }, 'generating'],
    ['partial failure result', { orderResult, analysisStatus: 'success', batchStartedAt: 10, batchFinishedAt: 20 }, 'results'],
    ['completed history restore', { orderResult, analysisStatus: 'idle', batchStartedAt: 10, batchFinishedAt: 20 }, 'results'],
  ] as const)('derives %s without a persisted workflow field', (_label, state, expected) => {
    expect(deriveMobileAfternoonTeaPhase(state)).toBe(expected)
  })

  it('returns to input after a refreshed analysis request while preserving external drafts', () => {
    expect(deriveMobileAfternoonTeaPhase({
      orderResult: null,
      analysisStatus: 'idle',
      batchStartedAt: null,
      batchFinishedAt: null,
    })).toBe('input')
  })
})

describe('mobile afternoon tea result selection', () => {
  const firstTask = task('task-a', 'done', ['image-a'])
  const secondTask = task('task-b', 'done', ['image-b'])
  const failedTask = task('task-failed', 'error')
  const first = { id: 'poster-a', title: '午后茶歇', prompt: 'prompt A', status: 'done' as const, task: firstTask }
  const second = { id: 'poster-b', title: '暖心时光', prompt: 'prompt B', status: 'done' as const, task: secondTask }

  it('uses only the first output of successful tasks as candidates', () => {
    const candidates = getMobileAfternoonTeaCandidates([
      { ...first, task: { ...firstTask, outputImages: ['image-a', 'image-a-extra'] } },
      { id: 'poster-failed', title: '失败', prompt: 'prompt failed', status: 'error', task: failedTask },
      { id: 'poster-empty', title: '缺图', prompt: 'prompt empty', status: 'done', task: task('task-empty', 'done') },
    ])

    expect(candidates.map((candidate) => candidate.imageId)).toEqual(['image-a'])
  })

  it('selects the first success, preserves a manual choice, and falls back after deletion', () => {
    const firstOnly = getMobileAfternoonTeaCandidates([first])
    const both = getMobileAfternoonTeaCandidates([first, second])

    expect(resolveMobileAfternoonTeaSelection(firstOnly, null)).toBe('poster-a')
    expect(resolveMobileAfternoonTeaSelection(both, 'poster-a')).toBe('poster-a')
    expect(resolveMobileAfternoonTeaSelection(both, 'poster-b')).toBe('poster-b')
    expect(resolveMobileAfternoonTeaSelection(firstOnly, 'poster-b')).toBe('poster-a')
    expect(resolveMobileAfternoonTeaSelection([], 'poster-b')).toBeNull()
  })

  it('keeps candidates independently selectable when generated images have the same content ID', () => {
    const duplicateImageTask = { ...secondTask, outputImages: ['image-a'] }
    const candidates = getMobileAfternoonTeaCandidates([
      first,
      { ...second, task: duplicateImageTask },
    ])

    expect(candidates.map((candidate) => candidate.itemId)).toEqual(['poster-a', 'poster-b'])
    expect(resolveMobileAfternoonTeaSelection(candidates, 'poster-b')).toBe('poster-b')
  })
})

describe('mobile afternoon tea clipboard', () => {
  it('exposes paste only in a secure context with clipboard text access', () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn() } })
    expect(canReadAfternoonTeaClipboard()).toBe(true)

    vi.stubGlobal('isSecureContext', false)
    expect(canReadAfternoonTeaClipboard()).toBe(false)
  })

  it('keeps the original menu when clipboard access fails', async () => {
    const result = await readAfternoonTeaClipboardText('原菜单', vi.fn().mockRejectedValue(new Error('denied')))

    expect(result).toEqual({
      text: '原菜单',
      error: '无法读取剪贴板，请长按菜单输入框粘贴',
    })
  })

  it('accepts only the latest clipboard read and invalidates pending reads', async () => {
    const createCoordinator = (mobileWorkflowHelpers as Record<string, unknown>).createAfternoonTeaClipboardCoordinator as (() => {
      read: (currentText: string, readText: () => Promise<string>) => Promise<{ text: string; error: string } | null>
      invalidate: () => void
    }) | undefined
    expect(createCoordinator).toBeTypeOf('function')
    if (!createCoordinator) return

    let resolveFirst: (value: string) => void = noop
    let resolveSecond: (value: string) => void = noop
    let resolvePending: (value: string) => void = noop
    const coordinator = createCoordinator()
    const first = coordinator.read('第一份菜单', () => new Promise((resolve) => { resolveFirst = resolve }))
    const second = coordinator.read('第二份菜单', () => new Promise((resolve) => { resolveSecond = resolve }))

    resolveSecond('最新菜单')
    await expect(second).resolves.toEqual({ text: '最新菜单', error: '' })
    resolveFirst('过期菜单')
    await expect(first).resolves.toBeNull()

    const pending = coordinator.read('当前菜单', () => new Promise((resolve) => { resolvePending = resolve }))
    coordinator.invalidate()
    resolvePending('卸载后返回的菜单')
    await expect(pending).resolves.toBeNull()
  })
})

describe('AfternoonTeaMobileWorkflow', () => {
  it('submits confirmed poster title drafts as one atomic title set', () => {
    const confirmStart = mobileWorkflowSource.indexOf('const handleConfirmAndGenerate = () => {')
    const confirmSource = mobileWorkflowSource.slice(confirmStart, mobileWorkflowSource.indexOf('const moveSelection', confirmStart))

    expect(mobileWorkflowSource).toContain('onPosterTitlesChange: (titles: string[]) => void')
    expect(confirmSource).toContain('props.onPosterTitlesChange(normalizedTitles)')
    expect(confirmSource).not.toContain('normalizedTitles.forEach')
    expect(confirmSource.indexOf('props.onPosterTitlesChange(normalizedTitles)'))
      .toBeLessThan(confirmSource.indexOf('props.onConfirmAndGenerate()'))
    expect(confirmSource.indexOf('props.onItemNameChange(index, normalized)'))
      .toBeLessThan(confirmSource.indexOf('props.onConfirmAndGenerate()'))
    expect(confirmSource.indexOf('commitItemTags(index)'))
      .toBeLessThan(confirmSource.indexOf('props.onConfirmAndGenerate()'))
  })

  it('invalidates a pending clipboard read before analysis starts', () => {
    const inputActionStart = mobileWorkflowSource.indexOf("{phase === 'input' && (")
    const inputActionSource = mobileWorkflowSource.slice(inputActionStart, mobileWorkflowSource.indexOf("{phase === 'analyzing' && (", inputActionStart))

    expect(inputActionSource.indexOf('clipboardCoordinator.invalidate()'))
      .toBeLessThan(inputActionSource.indexOf('props.onSubmit()'))
  })

  it('uses one responsive phase DOM for mobile and desktop layouts', () => {
    const inputHtml = renderWorkflow({ orderResult: null, analysisStatus: 'idle', itemTitleRegions: [] })
    const reviewHtml = renderWorkflow()
    const doneTask = task('task-done', 'done', ['image-a'])
    const resultsHtml = renderWorkflow({
      items: [{ id: 'poster-a', title: '午后茶歇', prompt: 'prompt A', status: 'done', task: doneTask }],
      batchStartedAt: 10,
      batchFinishedAt: 20,
    })

    expect(classForLabel(inputHtml, '素材工作区')).toMatch(/lg:grid-cols-\[/)
    expect(classForLabel(reviewHtml, '审查工作区')).toMatch(/lg:grid-cols-\[/)
    expect(classForLabel(resultsHtml, '生成与保存工作区')).toMatch(/lg:flex-row/)
    expect(resultsHtml).toContain('role="separator"')
    expect(resultsHtml).toContain('aria-label="批次结果槽位"')
    expect(resultsHtml).toContain('data-task-card="task-done"')
    expect(mobileWorkflowSource).toContain('sm:px-6')
    expect(mobileWorkflowSource).toContain('lg:justify-end')
    expect(mobileWorkflowSource).toContain('lg:min-w-56')
    expect(mobileWorkflowSource).not.toMatch(/(?:sm|md):grid-cols-\[minmax\(0,0\.9fr\)/)
  })


  it('shows generation results before the large preview on mobile', () => {
    const start = mobileWorkflowSource.indexOf("{(phase === 'generating' || phase === 'results') && (")
    const source = mobileWorkflowSource.slice(start, mobileWorkflowSource.indexOf('aria-label="工作流主操作"', start))
    expect(source).toContain('order-3 min-w-0 lg:order-none')
    expect(source).toContain('order-1 min-w-0 space-y-4 lg:order-none')
    expect(source).toContain('aria-label="批次结果槽位"')
    expect(mobileWorkflowSource).toContain('fixed inset-x-0 bottom-0')
  })

  it('offers task details for every materialized result without fabricating one for queued slots', () => {
    const items = [
      { id: 'running', title: '生成中的海报', prompt: 'running prompt', status: 'running' as const, task: task('task-running', 'running') },
      { id: 'done', title: '完成的海报', prompt: 'done prompt', status: 'done' as const, task: task('task-done', 'done', ['image-a']) },
      { id: 'error', title: '失败的海报', prompt: 'error prompt', status: 'error' as const, error: '生成失败', task: task('task-error', 'error') },
      { id: 'missing', title: '图片缺失的海报', prompt: 'missing prompt', status: 'done' as const, task: task('task-missing', 'done') },
      { id: 'queued', title: '等待的海报', prompt: 'queued prompt', status: 'queued' as const },
    ]
    const html = renderWorkflow({ items, batchStartedAt: 10, batchFinishedAt: 20 })
    const resultSlotStart = mobileWorkflowSource.indexOf('aria-label="批次结果槽位"')
    const resultSlotSource = mobileWorkflowSource.slice(resultSlotStart, mobileWorkflowSource.indexOf('(props.pageError || saveStatus)', resultSlotStart))

    // 有任务的结果用画廊同款 TaskCard 展示；排队中无任务的仍为占位行
    expect(html).toContain('data-task-card="task-running"')
    expect(html).toContain('data-task-card="task-done"')
    expect(html).toContain('data-task-card="task-error"')
    expect(html).toContain('data-task-card="task-missing"')
    expect(html).not.toContain('data-task-card="task-queued"')
    expect(html).toContain('data-mobile-result-slot="queued"')
    expect(html).toContain('>等待生成<')
    expect(resultSlotSource).toContain('props.onTaskClick(slot.task!)')
    expect(resultSlotSource).toContain('<TaskCard')
  })

  it('orders the review canvas before numbered poster titles and combined item metadata', () => {
    const html = renderWorkflow()
    const placement = html.indexOf('aria-label="订单商品位置设置"')
    const posterTitles = html.indexOf('>海报标题<')
    const itemMetadata = html.indexOf('>餐品与标签<')

    expect(placement).toBeGreaterThan(-1)
    expect(placement).toBeLessThan(posterTitles)
    expect(posterTitles).toBeLessThan(itemMetadata)
    expect(html).toContain('aria-label="海报标题 01"')
    expect(html).toContain('aria-label="海报标题 02"')
    expect(html).toMatch(/aria-label="海报标题 01"[^>]*class="[^"]*bg-blue-50[^"]*"/)
    expect(html).toContain('>01<')
    expect(html).toContain('>02<')
    expect(html).not.toContain('>餐品标签<')
  })

  it('shows numbered pins for every review item and highlights the selected list row', () => {
    const html = renderWorkflow()

    expect(html).toContain('data-item-title-pin="0"')
    expect(html).toContain('data-item-title-pin="1"')
    expect(html).toContain('aria-label="拖动商品 柠檬红茶"')
    expect(html).toContain('aria-label="拖动商品 草莓蛋糕"')
    expect(html).toContain('aria-label="定位餐品 1"')
    expect(html).toContain('aria-label="定位餐品 2"')
    expect(html).toContain('aria-pressed="true"')
    expect(mobileWorkflowSource).toContain('selectedIndex={placementSelectedIndex}')
    expect(mobileWorkflowSource).toContain('onSelectedIndexChange={setPlacementSelectedIndex}')
  })

  it('lets review attach a source image after text-only analysis', () => {
    const html = renderWorkflow({ imageDataUrl: '' })
    const placementStart = html.indexOf('aria-label="餐品摆放"')
    const placementEnd = html.indexOf('aria-label="海报标题"', placementStart)
    const placementArea = html.slice(placementStart, placementEnd)

    expect(html).toContain('解析已完成，请粘贴或上传餐品图片')
    expect(placementArea).toContain('aria-label="拍照"')
    expect(placementArea).toContain('aria-label="选择照片"')
    expect(placementArea).toContain('Ctrl/⌘ + V 粘贴')
    expect(html).toContain('生成海报需要一张餐品图片')
    expect(html).not.toContain('aria-label="移除餐品图片"')
  })

  it('keeps image pickers available while analysis is running', () => {
    const html = renderWorkflow({
      orderResult: null,
      analysisStatus: 'running',
      busy: true,
      imageDataUrl: '',
      itemTitleRegions: [],
    })
    const imageStart = html.indexOf('aria-label="餐品图片"')
    const imageEnd = html.indexOf('aria-label="菜单内容"', imageStart)
    const imageArea = html.slice(imageStart, imageEnd)

    expect(html).toContain('可先解析菜单，稍后再贴图')
    expect(imageArea).toContain('aria-label="拍照"')
    expect(imageArea).toContain('aria-label="选择照片"')
    expect(imageArea).not.toContain('pointer-events-none')
    const menuInputIndex = html.indexOf('aria-label="菜单输入"')
    const menuInputTag = html.slice(html.lastIndexOf('<textarea', menuInputIndex), html.indexOf('>', menuInputIndex) + 1)
    expect(menuInputTag).toContain('disabled')
  })

  it('shows item tags inline and exposes one editor for both name and tags', () => {
    const html = renderWorkflow()
    const itemSectionStart = mobileWorkflowSource.indexOf('<section aria-label="餐品与标签">')
    const itemSectionSource = mobileWorkflowSource.slice(itemSectionStart, mobileWorkflowSource.indexOf('<details className="group', itemSectionStart))
    const itemCommitStart = mobileWorkflowSource.indexOf('const commitItem = (index: number) => {')
    const itemCommitSource = mobileWorkflowSource.slice(itemCommitStart, mobileWorkflowSource.indexOf('const handleConfirmAndGenerate', itemCommitStart))

    expect(html).toMatch(/草莓蛋糕[\s\S]*草莓[\s\S]*奶油/)
    expect(html).toContain('aria-label="编辑餐品与标签 1"')
    expect(html).not.toContain('aria-label="编辑餐品名称 1"')
    expect(itemSectionStart).toBeGreaterThan(-1)
    expect((itemSectionSource.match(/aria-label=\{`编辑餐品与标签/g) ?? [])).toHaveLength(1)
    expect(itemSectionSource).toContain('aria-label={`餐品名称 ${index + 1}`}')
    expect(itemSectionSource).toContain('aria-label={`餐品标签 ${index + 1}`}')
    expect(itemSectionSource).toContain('relatedTarget')
    expect(itemCommitSource).toContain('props.onItemNameChange(index, normalized)')
    expect(itemCommitSource).toContain('props.onItemTagsChange(index, tags)')
  })

  it('keeps the combined item editor open for internal focus and commits both drafts after focus leaves', async () => {
    const onItemNameChange = vi.fn()
    const onItemTagsChange = vi.fn()
    const driver = await createWorkflowHookDriver({ onItemNameChange, onItemTagsChange })
    let tree = driver.render()

    callHandler(elementByLabel(tree, '编辑餐品与标签 1'), 'onClick')
    tree = driver.render()
    expect(elementByLabel(tree, '餐品名称 1')).toBeTruthy()
    expect(elementByLabel(tree, '餐品标签 1')).toBeTruthy()

    callHandler(elementByLabel(tree, '餐品名称 1'), 'onChange', { target: { value: '莓果酥塔' } })
    callHandler(elementByLabel(tree, '餐品标签 1'), 'onChange', { target: { value: '莓果，酥脆' } })
    tree = driver.render()
    const editor = findElement(tree, (element) => (
      typeof element.props?.onBlur === 'function'
      && findElement(element.props.children, (child) => child.props?.['aria-label'] === '餐品名称 1') != null
    ))
    expect(editor).not.toBeNull()

    const insideTarget = {}
    const containsInside = vi.fn((target) => target === insideTarget)
    callHandler(editor as ElementNode, 'onBlur', {
      currentTarget: { contains: containsInside },
      relatedTarget: insideTarget,
    })
    expect(containsInside).toHaveBeenCalledWith(insideTarget)
    expect(onItemNameChange).not.toHaveBeenCalled()
    expect(onItemTagsChange).not.toHaveBeenCalled()
    tree = driver.render()
    expect(elementByLabel(tree, '餐品标签 1')).toBeTruthy()

    const outsideEditor = findElement(tree, (element) => (
      typeof element.props?.onBlur === 'function'
      && findElement(element.props.children, (child) => child.props?.['aria-label'] === '餐品名称 1') != null
    ))
    const containsOutside = vi.fn(() => false)
    callHandler(outsideEditor as ElementNode, 'onBlur', {
      currentTarget: { contains: containsOutside },
      relatedTarget: null,
    })
    expect(containsOutside).toHaveBeenCalledWith(null)
    expect(onItemNameChange).toHaveBeenCalledWith(0, '莓果酥塔')
    expect(onItemTagsChange).toHaveBeenCalledWith(0, ['莓果', '酥脆'])
    tree = driver.render()
    expect(findElement(tree, (element) => element.props?.['aria-label'] === '餐品名称 1')).toBeNull()
    expect(elementByLabel(tree, '编辑餐品与标签 1')).toBeTruthy()
  })

  it('submits current combined item drafts before generation while the editor is still open', async () => {
    const events: string[] = []
    const driver = await createWorkflowHookDriver({
      onItemNameChange: (index, name) => { events.push(`name:${index}:${name}`) },
      onItemTagsChange: (index, tags) => { events.push(`tags:${index}:${tags.join('|')}`) },
      onConfirmAndGenerate: () => { events.push('confirm') },
    })
    let tree = driver.render()

    callHandler(elementByLabel(tree, '编辑餐品与标签 1'), 'onClick')
    tree = driver.render()
    callHandler(elementByLabel(tree, '餐品名称 1'), 'onChange', { target: { value: '伯爵茶蛋糕' } })
    callHandler(elementByLabel(tree, '餐品标签 1'), 'onChange', { target: { value: '伯爵茶，蛋糕' } })
    tree = driver.render()
    expect(elementByLabel(tree, '餐品名称 1').props.value).toBe('伯爵茶蛋糕')
    expect(elementByLabel(tree, '餐品标签 1').props.value).toBe('伯爵茶，蛋糕')

    const confirm = findElement(tree, (element) => element.type === 'button' && elementText(element) === '确认并生成 2 张')
    expect(confirm).not.toBeNull()
    callHandler(confirm as ElementNode, 'onClick')

    expect(events).toEqual([
      'name:0:伯爵茶蛋糕',
      'tags:0:伯爵茶|蛋糕',
      'confirm',
    ])
  })

  it('submits the current poster title draft before generation while the editor is still open', async () => {
    const events: string[] = []
    const onPosterTitlesChange = vi.fn((titles: string[]) => {
      events.push(`titles:${titles.join('|')}`)
    })
    const driver = await createWorkflowHookDriver({
      onPosterTitlesChange,
      onConfirmAndGenerate: () => { events.push('confirm') },
    })
    let tree = driver.render()

    callHandler(elementByLabel(tree, '编辑海报标题 1'), 'onClick')
    tree = driver.render()
    callHandler(elementByLabel(tree, '海报标题 1'), 'onChange', { target: { value: '莓果午后' } })
    tree = driver.render()
    expect(elementByLabel(tree, '海报标题 1').props.value).toBe('莓果午后')

    const confirm = findElement(tree, (element) => element.type === 'button' && elementText(element) === '确认并生成 2 张')
    expect(confirm).not.toBeNull()
    callHandler(confirm as ElementNode, 'onClick')

    expect(onPosterTitlesChange).toHaveBeenCalledWith(['莓果午后', '暖心时光'])
    expect(events).toEqual([
      'titles:莓果午后|暖心时光',
      'confirm',
    ])
  })

  it('uses explicit accessible edit actions and a safe-area primary action', () => {
    const html = renderWorkflow()

    expect(html).toContain('aria-label="编辑海报标题 1"')
    expect(html).toContain('aria-label="编辑餐品与标签 1"')
    expect(html).toContain('确认并生成 2 张')
    expect(html).toContain('min-h-11')
    expect(html).toContain('env(safe-area-inset-bottom)')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('当前步骤：审查，2/4')
  })

  it('uses one desktop top bar for progress and the phase CTA while keeping the mobile CTA sticky', () => {
    const html = renderWorkflow()

    expect(classForLabel(html, '餐品海报工作流')).toContain('lg:grid-cols-[minmax(0,1fr)_auto]')
    expect(classForLabel(html, '餐品海报进度')).toMatch(/lg:col-start-1.*lg:row-start-1/)
    expect(classForLabel(html, '工作流主操作')).toMatch(/fixed inset-x-0 bottom-0.*lg:static.*lg:col-start-2.*lg:row-start-1/)
    expect(classForLabel(html, '审查工作区')).toMatch(/lg:col-span-2.*lg:row-start-2/)
    expect((mobileWorkflowSource.match(/aria-label="工作流主操作"/g) ?? [])).toHaveLength(1)
    expect(html).toContain('env(safe-area-inset-bottom)')
  })

  it('renders the existing wand animation after the generating progress text', () => {
    const html = renderWorkflow({
      items: [{ id: 'poster-a', title: '午后茶歇', prompt: 'prompt A', status: 'running', task: task('task-running', 'running') }],
      batchStartedAt: 10,
      batchFinishedAt: null,
    })
    const progressText = html.indexOf('生成中 0 / 1')
    const wand = html.indexOf('class="dark:invert"', progressText)

    expect(mobileWorkflowSource).toContain("import { WandAnimation } from '../wand-animation-react'")
    expect(progressText).toBeGreaterThan(-1)
    expect(wand).toBeGreaterThan(progressText)
    expect(html.slice(wand, wand + 100)).toContain('width:28px;height:28px')
  })

  it('renders touch-sized camera, photo, and count stepper controls on the input phase', () => {
    const html = renderWorkflow({ orderResult: null, analysisStatus: 'idle', itemTitleRegions: [] })

    expect(html).toContain('>拍照<')
    expect(html).toContain('>照片<')
    expect(html).toContain('aria-label="减少海报数量"')
    expect(html).toContain('aria-label="增加海报数量"')
    expect(html).toContain('开始解析')
    expect(html).toContain('min-h-11')
    expect((mobileWorkflowSource.match(/has-\[:focus-visible\]:ring-2/g) ?? [])).toHaveLength(2)
  })

  it('locks input actions while the selected image is still loading', () => {
    const html = renderWorkflow({
      orderResult: null,
      analysisStatus: 'idle',
      imageDataUrl: '',
      imageLoading: true,
      itemTitleRegions: [],
    })

    expect(html).toMatch(/<input[^>]*disabled=""[^>]*aria-label="拍照"/)
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*aria-label="选择照片"/)
    expect(html).toMatch(/<textarea[^>]*disabled=""[^>]*aria-label="菜单输入"/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="增加海报数量"/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>开始解析<\/button>/)
  })

  it('keeps one stable result slot per item and hides the save action when all outputs fail', () => {
    const failedItems = [
      { id: 'poster-a', title: '午后茶歇', prompt: 'prompt A', status: 'error' as const, error: '失败 A' },
      { id: 'poster-b', title: '暖心时光', prompt: 'prompt B', status: 'error' as const, error: '失败 B' },
    ]
    const html = renderWorkflow({ items: failedItems, batchStartedAt: 10, batchFinishedAt: 20 })

    expect((html.match(/data-mobile-result-slot=/g) ?? [])).toHaveLength(2)
    expect(html).toContain('失败 2')
    expect(html).not.toContain('打开系统保存')
    expect(html).not.toContain('sticky bottom-0')
  })

  it('shows a save preparation action when at least one successful image exists', () => {
    const doneTask = task('task-done', 'done', ['image-a'])
    const html = renderWorkflow({
      items: [{ id: 'poster-a', title: '午后茶歇', prompt: 'prompt A', status: 'done', task: doneTask }],
      batchStartedAt: 10,
      batchFinishedAt: 20,
    })

    expect(html).toContain('准备图片...')
    expect(html).toContain('aria-label="保存当前海报图片"')
  })
})

describe('generate split pane', () => {
  it('clamps left percent into the allowed range', () => {
    expect(clampGenerateSplitLeftPercent(10)).toBe(30)
    expect(clampGenerateSplitLeftPercent(90)).toBe(70)
    expect(clampGenerateSplitLeftPercent(52)).toBe(52)
    expect(clampGenerateSplitLeftPercent(Number.NaN)).toBe(52)
  })

  it('reads and writes the persisted split ratio', () => {
    const memory = new Map<string, string>()
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) },
    }
    expect(readGenerateSplitLeftPercent(storage)).toBe(52)
    writeGenerateSplitLeftPercent(63, storage)
    expect(readGenerateSplitLeftPercent(storage)).toBe(63)
    writeGenerateSplitLeftPercent(5, storage)
    expect(readGenerateSplitLeftPercent(storage)).toBe(30)
  })

  it('exposes a desktop-only resizable separator between preview and results', () => {
    expect(mobileWorkflowSource).toContain('role="separator"')
    expect(mobileWorkflowSource).toContain('aria-label="调整预览与结果区域宽度"')
    expect(mobileWorkflowSource).toContain('cursor-col-resize')
    expect(mobileWorkflowSource).toContain('onDoubleClick={resetGenerateSplit}')
    expect(mobileWorkflowSource).toContain('isDesktopGenerateSplit')
    expect(mobileWorkflowSource).toContain('data-generate-result-grid')
    expect(mobileWorkflowSource).toContain('repeat(auto-fill,minmax(min(100%,19rem),1fr))')
  })
})
