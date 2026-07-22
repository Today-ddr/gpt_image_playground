import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } from '../lib/apiProfiles'
import { AfternoonTeaBatchCoordinator } from '../lib/afternoonTeaBatch'
import { DEFAULT_DISH_TITLE_COUNT } from '../lib/dishAnalysisPrompts'
import { DEFAULT_PARAMS, type AfternoonTeaConversation, type AfternoonTeaPosterBatchItem, type AppSettings, type TaskRecord } from '../types'
import * as workspaceHelpers from './ToolsWorkspace'
import {
  DishAnalysisCoordinator,
  DishAnalysisFormView,
  MAX_DISH_IMAGE_BYTES,
  ToolsWorkflowSteps,
  deriveAfternoonTeaPosterViewItems,
  getDishAnalysisProfile,
  normalizeDishTitleCount,
  validateDishAnalysisInput,
  validateDishImageFile,
} from './ToolsWorkspace'
import appSource from '../App.tsx?raw'
import iconsSource from './icons.tsx?raw'
import workspaceSource from './ToolsWorkspace.tsx?raw'
import mockApiSource from '../../scripts/mock-image-api.mjs?raw'

const noop = () => {}

const helper = (name: string) => (workspaceHelpers as Record<string, unknown>)[name] as ((...args: unknown[]) => unknown) | undefined

function afternoonTeaConversation(overrides: Partial<AfternoonTeaConversation> = {}): AfternoonTeaConversation {
  return {
    id: 'conversation-a', title: '下午茶', createdAt: 1, updatedAt: 1,
    sourceImageId: 'source-a', sourceImageName: 'tea.png', orderText: '订单', titleCount: 2,
    systemPrompt: '系统', analysisSystemPromptSnapshot: '分析系统', analysisUserPromptSnapshot: '分析用户',
    analysisElapsed: null,
    orderResult: { titles: ['海报'], items: [{ displayName: '蛋糕', tags: [] }] },
    posterItems: [{ id: 'poster-a', title: '海报', prompt: 'prompt' }],
    batchStartedAt: null, batchFinishedAt: null, ...overrides,
  }
}

function afternoonTeaSettings(profile = createDefaultOpenAIProfile({ id: 'openai', apiKey: 'secret', model: 'image-model' })): AppSettings {
  return normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
}

function renderForm(overrides: Partial<Parameters<typeof DishAnalysisFormView>[0]> = {}) {
  return renderToStaticMarkup(<DishAnalysisFormView
    configured
    imageDataUrl=""
    userPrompt="请解析这张餐品图片"
    systemPrompt="你是餐品分析助手"
    titleCount={DEFAULT_DISH_TITLE_COUNT}
    orderResult={null}
    error=""
    loading={false}
    analysisStatus="idle"
    analysisElapsed={null}
    locked={false}
    onImageChange={noop}
    onRemoveImage={noop}
    onUserPromptChange={noop}
    onSystemPromptChange={noop}
    onTitleCountChange={noop}
    onResetSystemPrompt={noop}
    onSubmit={noop}
    onCancel={noop}
    onClear={noop}
    onGoPoster={noop}
    {...overrides}
  />)
}

describe('DishAnalysisFormView', () => {
  it('mounts the tools workspace from tools mode', () => {
    expect(appSource).toContain("appMode === 'tools' && <ToolsWorkspace />")
  })

  it('renders the complete dish analysis workflow', () => {
    const html = renderForm()
    expect(html).toContain('餐品解析')
    expect(html).toContain('上传餐品图片')
    expect(html).toContain('餐品图片')
    expect(html).not.toContain('餐品图片（可选）')
    expect(html).toContain('Ctrl/⌘ + V 粘贴')
    expect(html).toContain('下午茶订单')
    expect(html).toContain('系统提示词')
    expect(html).toContain('恢复默认')
    expect(html).toContain('解析结果')
    expect(html).toContain('开始解析')
    expect(html).toContain('生成数量')
    expect(html).toContain('min="1"')
    expect(html).toContain('max="10"')
    expect(html).toContain('value="4"')
  })

  it('keeps both empty and uploaded image frames compact', () => {
    expect(renderForm()).toMatch(/<label class="[^"]*w-full max-w-48[^"]*"/)
    expect(renderForm({ imageDataUrl: 'data:image/png;base64,AQID' }))
      .toMatch(/<div class="[^"]*w-full max-w-48[^"]*">/)
  })

  it('overlays the remove action without a filename footer', () => {
    const html = renderForm({ imageDataUrl: 'data:image/png;base64,AQID' })
    const propsSource = workspaceSource.slice(
      workspaceSource.indexOf('type DishAnalysisFormViewProps = {'),
      workspaceSource.indexOf('type ToolsWorkflowStepsProps = {'),
    )
    const callStart = workspaceSource.indexOf('<DishAnalysisFormView')
    const callSource = workspaceSource.slice(callStart, workspaceSource.indexOf('/>', callStart) + 2)

    expect(html).toContain('aria-label="移除餐品图片"')
    expect(html).toMatch(/<button[^>]*class="[^"]*absolute right-2 top-2[^"]*"/)
    const removeButtonClass = html.match(/<button[^>]*class="([^"]*absolute right-2 top-2[^"]*)"[^>]*aria-label="移除餐品图片"/)?.[1] ?? ''
    expect(removeButtonClass.split(/\s+/)).not.toContainEqual(expect.stringMatching(/^(?:[^:]+:)*-?z-/))
    expect(html).toContain('h-7 w-7')
    expect(html).toContain('focus-visible:')
    expect(html).not.toContain('border-t')
    expect(propsSource).not.toContain('imageName')
    expect(callSource).not.toContain('imageName')
  })

  it('groups the image with the order and keeps advanced settings collapsed', () => {
    const html = renderForm()

    expect(html).toContain('grid items-start gap-4 md:grid-cols-[192px_minmax(0,1fr)]')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toMatch(/<summary[^>]*>[\s\S]*系统提示词[\s\S]*高级设置[\s\S]*<\/summary>/)
  })

  it('places title count and parsing controls in one action bar', () => {
    const html = renderForm()

    expect(html).toMatch(/<div[^>]*aria-label="解析操作"[^>]*>[\s\S]*生成数量[\s\S]*开始解析/)
    expect(html).toContain('grid grid-cols-[7rem_minmax(0,1fr)]')
    expect(html).toContain('min-h-0')
    expect(html).toContain('lg:min-h-[360px]')
  })

  it('renders every analysis status with a stable elapsed time', () => {
    expect(renderForm()).toContain('等待解析')
    expect(renderForm()).toContain('耗时 --:--')
    const runningHtml = renderForm({ loading: true, analysisStatus: 'running', analysisElapsed: 8_000 })
    expect(runningHtml).toContain('解析中')
    expect(runningHtml).toContain('耗时 00:08')
    expect(runningHtml).toContain('取消解析')
    const successHtml = renderForm({ analysisStatus: 'success', analysisElapsed: 65_000 })
    expect(successHtml).toContain('解析成功')
    expect(successHtml).toContain('耗时 01:05')
    expect(successHtml).toContain('重新解析')
    const errorHtml = renderForm({ error: '请求失败', analysisStatus: 'error', analysisElapsed: 12_000 })
    expect(errorHtml).toContain('解析失败')
    expect(errorHtml).toContain('请检查订单内容后点击“重试解析”')
    expect(errorHtml).toContain('重试解析')
    const cancelledHtml = renderForm({ analysisStatus: 'cancelled', analysisElapsed: 5_000 })
    expect(cancelledHtml).toContain('已取消')
    expect(cancelledHtml).toContain('重新解析')
  })

  it('renders configuration, loading, error, and result states', () => {
    expect(renderForm({ configured: false })).toContain('请先在 API 配置中选择 OpenAI 配置')
    expect(renderForm({ loading: true })).toContain('取消解析')
    expect(renderForm({ error: '请求失败' })).toContain('请求失败')
    const resultHtml = renderForm({
      imageDataUrl: 'data:image/png;base64,AQID',
      orderResult: {
        titles: ['午后茶歇', '暖心时光'],
        items: [{ displayName: '草莓酸奶碗', tags: ['草莓', '酸奶'] }],
      },
    })
    expect(resultHtml).toContain('午后茶歇')
    expect(resultHtml).toContain('暖心时光')
    expect(resultHtml).toContain('草莓酸奶碗')
    expect(resultHtml).toContain('草莓')
    expect(resultHtml).toContain('酸奶')
    expect(resultHtml).toContain('进入批量海报')
    expect(resultHtml).not.toContain('&quot;titles&quot;')
    expect(resultHtml).toContain('清空')
  })

  it('keeps parser failures on the order step without rendering raw JSON', () => {
    const html = renderForm({ error: '下午茶订单解析结果格式无效', analysisStatus: 'error' })
    expect(html).toContain('下午茶订单解析结果格式无效')
    expect(html).toContain('请检查订单内容后点击“重试解析”')
    expect(html).toContain('重试解析')
    expect(html).toContain('解析结果将显示在这里')
    expect(html).not.toContain('&quot;items&quot;')
  })

  it('requires order text even when an image is uploaded', () => {
    expect(renderForm({ imageDataUrl: '', userPrompt: '' })).toMatch(/<button[^>]*disabled=""[^>]*>开始解析<\/button>/)
    expect(renderForm({ imageDataUrl: 'data:image/png;base64,AQID', userPrompt: '' })).toMatch(/<button[^>]*disabled=""[^>]*>开始解析<\/button>/)
    expect(renderForm({ imageDataUrl: '', userPrompt: '今日茶歇' })).not.toMatch(/<button[^>]*disabled=""[^>]*>开始解析<\/button>/)
  })
})

describe('ToolsWorkflowSteps', () => {
  it('renders both steps and disables poster before a valid result exists', () => {
    const html = renderToStaticMarkup(<ToolsWorkflowSteps
      step="order"
      posterEnabled={false}
      busy={false}
      onStepChange={noop}
    />)
    expect(html).toContain('订单解析')
    expect(html).toMatch(/<button[^>]*>订单解析<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>批量海报<\/button>/)
  })

  it('enables poster only after a valid result and locks navigation while busy', () => {
    const enabled = renderToStaticMarkup(<ToolsWorkflowSteps
      step="order"
      posterEnabled
      busy={false}
      onStepChange={noop}
    />)
    expect(enabled).not.toMatch(/<button[^>]*disabled=""[^>]*>批量海报<\/button>/)

    const busy = renderToStaticMarkup(<ToolsWorkflowSteps
      step="poster"
      posterEnabled
      busy
      onStepChange={noop}
    />)
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>订单解析<\/button>/)
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>批量海报<\/button>/)
  })

  it('uses a full-width mobile segmented control with touch-sized buttons', () => {
    const html = renderToStaticMarkup(<ToolsWorkflowSteps
      step="order"
      posterEnabled
      busy={false}
      onStepChange={noop}
    />)

    expect(html).toContain('role="group"')
    expect(html).toContain('grid grid-cols-2')
    expect(html).toContain('sm:flex')
    expect((html.match(/min-h-11/g) ?? [])).toHaveLength(2)
    expect(html).not.toContain('role="tab"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-pressed="false"')
  })
})

describe('dish analysis coordination', () => {
  it('continues only the active unfinished conversation on tool entry', () => {
    const resolveEntryConversation = helper('resolveAfternoonTeaEntryConversationId')
    const createCalls: unknown[] = []
    const createConversation = (options?: unknown) => {
      createCalls.push(options)
      return 'new-conversation'
    }

    expect(resolveEntryConversation).toBeTypeOf('function')
    expect(resolveEntryConversation?.(afternoonTeaConversation({ batchFinishedAt: null }), createConversation)).toBe('conversation-a')
    expect(createCalls).toEqual([])
    expect(resolveEntryConversation?.(afternoonTeaConversation({ batchStartedAt: 10, batchFinishedAt: 20 }), createConversation)).toBe('new-conversation')
    expect(resolveEntryConversation?.(null, createConversation)).toBe('new-conversation')
    expect(createCalls).toEqual([{ force: true }, { force: true }])
    expect(workspaceSource).toContain('initialConversationResolvedRef')
    expect(workspaceSource).toContain('resolveAfternoonTeaEntryConversationId')
  })

  it('derives status only from the active conversation run', () => {
    const deriveViewState = helper('deriveDishAnalysisViewState')
    const conversation = afternoonTeaConversation({ analysisElapsed: 65_000 })

    expect(deriveViewState).toBeTypeOf('function')
    expect(deriveViewState?.(conversation, null, 1_000)).toEqual({ status: 'success', elapsed: 65_000 })
    expect(deriveViewState?.(conversation, {
      conversationId: conversation.id,
      status: 'running',
      startedAt: 1_000,
      finishedAt: null,
    }, 9_000)).toEqual({ status: 'running', elapsed: 8_000 })
    expect(deriveViewState?.(conversation, {
      conversationId: 'other-conversation',
      status: 'error',
      startedAt: 1_000,
      finishedAt: 2_000,
    }, 9_000)).toEqual({ status: 'success', elapsed: 65_000 })
  })

  it('validates image type and the 20 MiB file limit', () => {
    expect(() => validateDishImageFile({ type: 'text/plain', size: 1 })).toThrow('请选择图片文件')
    expect(() => validateDishImageFile({ type: 'image/png', size: MAX_DISH_IMAGE_BYTES + 1 })).toThrow('餐品图片不能超过 20 MiB')
    expect(() => validateDishImageFile({ type: 'image/png', size: MAX_DISH_IMAGE_BYTES })).not.toThrow()
  })

  it('uses only the active OpenAI profile with an understanding model', () => {
    const openai = createDefaultOpenAIProfile({ id: 'openai', understandingModel: 'vision-model' })
    const fal = createDefaultFalProfile({ id: 'fal' })
    expect(getDishAnalysisProfile(normalizeSettings({ profiles: [openai, fal], activeProfileId: openai.id }))?.id).toBe(openai.id)
    expect(getDishAnalysisProfile(normalizeSettings({ profiles: [openai, fal], activeProfileId: fal.id }))).toBeNull()
    expect(getDishAnalysisProfile(normalizeSettings({ profiles: [{ ...openai, understandingModel: '' }], activeProfileId: openai.id }))).toBeNull()
  })

  it('clamps the title count to the supported range', () => {
    expect(normalizeDishTitleCount(0)).toBe(1)
    expect(normalizeDishTitleCount(7.9)).toBe(7)
    expect(normalizeDishTitleCount(11)).toBe(10)
    expect(normalizeDishTitleCount(Number.NaN)).toBe(4)
  })

  it('stores title count changes as the next conversation preference', () => {
    expect(workspaceSource).toContain('const setDefaultAfternoonTeaTitleCount = useStore((state) => state.setDefaultAfternoonTeaTitleCount)')
    expect(workspaceSource).toContain('setDefaultAfternoonTeaTitleCount(normalizedCount)')
  })

  it('requires an order and keeps the analysis request text-only', () => {
    expect(() => validateDishAnalysisInput('   ')).toThrow('请填写下午茶订单')
    expect(() => validateDishAnalysisInput('今日茶歇')).not.toThrow()
    expect(workspaceSource).toContain('validateDishAnalysisInput(requestUserPrompt)')
    expect(workspaceSource).not.toContain('imageDataUrl: requestImageDataUrl,')
    expect(workspaceSource.indexOf('validateDishAnalysisInput(requestUserPrompt)'))
      .toBeLessThan(workspaceSource.indexOf('await analyzeDish({'))
  })

  it('builds both dynamic prompts with the same state title count before submitting', () => {
    expect(workspaceSource).toContain('const analysisSystemPromptSnapshot = buildDishAnalysisSystemPrompt(requestSystemPrompt, requestTitleCount)')
    expect(workspaceSource).toContain('const analysisUserPromptSnapshot = buildDishAnalysisUserPrompt(requestUserPrompt, requestTitleCount)')
    expect(workspaceSource).toContain('parseAfternoonTeaOrderResult(raw, requestTitleCount)')
  })

  it('derives every poster state from the linked task and only uses the first completed output', () => {
    const batchItems: AfternoonTeaPosterBatchItem[] = [
      { id: 'queued', title: '等待', prompt: 'prompt queued' },
      { id: 'running', title: '生成中', prompt: 'prompt running', taskId: 'task-running' },
      { id: 'done', title: '成功', prompt: 'prompt done', taskId: 'task-done' },
      { id: 'failed', title: '失败', prompt: 'prompt failed', taskId: 'task-failed' },
      { id: 'setup', title: '创建失败', prompt: 'prompt setup', setupError: '创建失败' },
    ]
    const task = (id: string, status: TaskRecord['status'], outputImages: string[] = [], error: string | null = null) => ({
      id,
      prompt: id,
      params: {
        size: 'auto',
        quality: 'auto',
        output_format: 'png',
        output_compression: null,
        moderation: 'auto',
        n: 1,
        transparent_output: false,
      },
      inputImageIds: [],
      outputImages,
      status,
      error,
      createdAt: 1,
      finishedAt: status === 'running' ? null : 2,
      elapsed: status === 'running' ? null : 1,
    }) as TaskRecord
    const viewItems = deriveAfternoonTeaPosterViewItems(batchItems, [
      task('task-running', 'running'),
      task('task-done', 'done', ['image-first', 'image-second']),
      task('task-failed', 'error', [], '服务暂不可用'),
    ])

    expect(viewItems.map((item) => item.status)).toEqual(['queued', 'running', 'done', 'error', 'error'])
    expect(viewItems[2].task?.id).toBe('task-done')
    expect(viewItems[3].error).toContain('服务暂不可用')
    expect(viewItems[4].error).toBe('创建失败')
  })

  it('treats a missing linked task record as a retryable error', () => {
    const [viewItem] = deriveAfternoonTeaPosterViewItems([
      { id: 'missing', title: '记录丢失', prompt: 'prompt missing', taskId: 'task-missing' },
    ], [])

    expect(viewItem.status).toBe('error')
    expect(viewItem.error).toContain('任务记录不存在')
  })

  it('wires immutable generation snapshots and one cached source image into batch and retry', () => {
    expect(workspaceSource).toContain('createInputImageFromFile(file)')
    expect(workspaceSource).toContain("storeImage(requestImageDataUrl, 'upload')")
    expect(workspaceSource).toContain('const settingsSnapshot = normalizeSettings(settings)')
    expect(workspaceSource).toContain('normalizeParamsForSettings({ ...params }, settingsSnapshot, { hasInputImages: true })')
    expect(workspaceSource).toContain('runAfternoonTeaPosterBatch({')
    expect(workspaceSource).toContain('retryAfternoonTeaPosterItem({')
    expect(workspaceSource).toContain('submit: submitAfternoonTeaPosterTask')
    expect(workspaceSource).toContain('mountedRef.current && useStore.getState().activeAfternoonTeaConversationId === conversationId')
    expect(workspaceSource).toContain('batchId: conversationId')
    expect(workspaceSource).toContain('updateAfternoonTeaConversation(conversationId')
    expect(workspaceSource).toContain('busy={batchBusy || loading}')
  })

  it('holds one global operation lease across source setup, batch run, and retry', () => {
    const startSource = workspaceSource.slice(
      workspaceSource.indexOf('const startBatch = async () => {'),
      workspaceSource.indexOf('const retryItem = async (itemId: string) => {'),
    )
    const retrySource = workspaceSource.slice(
      workspaceSource.indexOf('const retryItem = async (itemId: string) => {'),
      workspaceSource.indexOf('const updateUserPrompt = (value: string) => {'),
    )
    expect(workspaceSource).toContain('const afternoonTeaBatchOperationId = useStore((state) => state.afternoonTeaBatchOperationId)')
    expect(workspaceSource).toContain('const batchBusy = Boolean(afternoonTeaBatchOperationId) || batchRunning || retrying')
    expect(startSource).toContain('if (!tryBeginAfternoonTeaBatchOperation(operationId)) return')
    expect(startSource.indexOf('tryBeginAfternoonTeaBatchOperation(operationId)'))
      .toBeLessThan(startSource.indexOf('await ensureImageCached'))
    expect(startSource).toContain('startAfternoonTeaConversationBatch(currentConversation')
    expect(retrySource).toContain('tryBeginAfternoonTeaBatchOperation(operationId)')
    expect(retrySource.indexOf('tryBeginAfternoonTeaBatchOperation(operationId)'))
      .toBeLessThan(retrySource.indexOf('await retryAfternoonTeaPosterItem({'))
    expect(workspaceSource.match(/finishAfternoonTeaBatchOperation\(operationId\)/g)).toHaveLength(2)
    expect(workspaceSource).not.toMatch(/onTaskCreated:[\s\S]{0,180}if \(!mountedRef\.current\) return/)
    expect(workspaceSource).toContain('disposeAfternoonTeaBatchRuntime(runtime, useStore.getState)')
    expect(workspaceSource).toContain('interruptUnclaimed: true')
  })

  it('uses the active conversation poster items and renders existing tasks through TaskCard wiring', () => {
    expect(workspaceSource).toContain('activeConversation?.posterItems ?? []')
    expect(workspaceSource).not.toContain('setOutputSources')
    expect(workspaceSource).not.toContain('outputSources')
    expect(workspaceSource).toContain('setDetailTaskId(task.id)')
    expect(workspaceSource).toContain("setAppMode('gallery')")
    expect(workspaceSource).toContain('void deps.reuseConfig(task)')
    expect(workspaceSource).toContain('void deps.editOutputs(task)')
  })

  it('suppresses stale image conversions and duplicate requests', () => {
    const coordinator = new DishAnalysisCoordinator()
    const firstImage = coordinator.beginImageSelection()
    const secondImage = coordinator.beginImageSelection()
    expect(coordinator.isCurrentImageSelection(firstImage)).toBe(false)
    expect(coordinator.isCurrentImageSelection(secondImage)).toBe(true)
    coordinator.invalidateImageSelection()
    expect(coordinator.isCurrentImageSelection(secondImage)).toBe(false)

    const request = coordinator.beginRequest()
    expect(request).toBeInstanceOf(AbortController)
    expect(coordinator.beginRequest()).toBeNull()
    coordinator.cancelRequest()
    expect(request?.signal.aborted).toBe(true)

    coordinator.finishRequest(request!)
    const nextRequest = coordinator.beginRequest()
    expect(nextRequest).toBeInstanceOf(AbortController)
    coordinator.dispose()
    expect(nextRequest?.signal.aborted).toBe(true)
  })

  it('keeps a just-started reparse request alive when consuming the cloned conversation restore', () => {
    const coordinator = new DishAnalysisCoordinator()
    coordinator.skipNextRestore('cloned-conversation')
    const request = coordinator.beginRequest()

    expect(coordinator.consumeRestoreSkip('cloned-conversation')).toBe(true)
    expect(coordinator.isCurrentRequest(request!)).toBe(true)
    expect(request?.signal.aborted).toBe(false)
    expect(workspaceSource).toContain('coordinatorRef.current.skipNextRestore(conversationId)')
    expect(workspaceSource).toContain('coordinatorRef.current.consumeRestoreSkip(activeAfternoonTeaConversationId)')
  })

  it('returns a cloned completed conversation to the order step before skipping restore', () => {
    const cloneSource = workspaceSource.slice(
      workspaceSource.indexOf('const createEditableConversationFrom ='),
      workspaceSource.indexOf('const initializeNewConversationPrompt ='),
    )

    expect(cloneSource).toContain("setStep('order')")
    expect(cloneSource.indexOf("setStep('order')"))
      .toBeLessThan(cloneSource.indexOf('coordinatorRef.current.skipNextRestore(conversationId)'))
  })

  it('clears a cloned conversation restore skip when a different conversation becomes active', () => {
    const coordinator = new DishAnalysisCoordinator()
    coordinator.skipNextRestore('cloned-conversation')

    expect(coordinator.consumeRestoreSkip('other-conversation')).toBe(false)
    expect(coordinator.consumeRestoreSkip('cloned-conversation')).toBe(false)
  })

  it('routes mock Chat Completions before image API fallbacks', () => {
    expect(mockApiSource).toContain("pathname.endsWith('/v1/chat/completions')")
    expect(mockApiSource).toContain('choices: [{ message: { content: JSON.stringify(result) } }]')
    expect(mockApiSource.indexOf('isOpenAIChatCompletionsPath(url.pathname)'))
      .toBeLessThan(mockApiSource.indexOf('isOpenAIImagesPath(url.pathname)'))
  })

  it('persists durable task callbacks after the UI owner has gone away and finishes only once', () => {
    let conversation = afternoonTeaConversation()
    const updates: Array<{ id: string; patch: Partial<AfternoonTeaConversation> }> = []
    const getState = () => ({
      afternoonTeaConversations: [conversation],
      updateAfternoonTeaConversation: (id: string, patch: Partial<AfternoonTeaConversation>) => {
        updates.push({ id, patch })
        conversation = { ...conversation, ...patch }
      },
    })
    const createCallbacks = helper('createAfternoonTeaBatchCallbacks')
    const callbacks = createCallbacks?.(getState, () => 900) as {
      onTaskCreated: (batchId: string, itemId: string, taskId: string) => void
      onItemSetupError: (batchId: string, itemId: string, error: unknown) => void
      onBatchFinished: (batchId: string) => void
    } | undefined
    expect(callbacks).toBeTruthy()
    callbacks?.onTaskCreated('conversation-a', 'poster-a', 'task-a')
    callbacks?.onItemSetupError('conversation-a', 'poster-a', new Error('创建失败'))
    callbacks?.onBatchFinished('conversation-a')
    callbacks?.onBatchFinished('conversation-a')

    expect(updates).toHaveLength(3)
    expect(updates[0]).toMatchObject({ id: 'conversation-a', patch: { posterItems: [{ taskId: 'task-a' }] } })
    expect(updates[1].patch.posterItems?.[0]).toMatchObject({ taskId: 'task-a', setupError: '创建失败' })
    expect(updates[2]).toMatchObject({ id: 'conversation-a', patch: { batchFinishedAt: 900 } })
  })

  it('disposes the runtime, blocks new claims, and interrupts only unclaimed items', () => {
    const coordinator = new AfternoonTeaBatchCoordinator()
    coordinator.start('conversation-a')
    let conversation = afternoonTeaConversation({
      batchStartedAt: 100,
      posterItems: [
        { id: 'unclaimed', title: '等待', prompt: 'prompt A' },
        { id: 'claimed', title: '生成中', prompt: 'prompt B', taskId: 'task-running' },
      ],
    })
    const getState = () => ({
      tasks: [{ id: 'task-running', status: 'running' } as TaskRecord],
      afternoonTeaConversations: [conversation],
      updateAfternoonTeaConversation: (_id: string, patch: Partial<AfternoonTeaConversation>) => {
        conversation = { ...conversation, ...patch }
      },
    })
    const disposeRuntime = helper('disposeAfternoonTeaBatchRuntime')
    expect(disposeRuntime).toBeTypeOf('function')
    disposeRuntime?.({ batchId: conversation.id, coordinator }, getState, () => 500)

    expect(coordinator.claim(conversation.id)).toBeNull()
    expect(conversation.posterItems).toEqual([
      { id: 'unclaimed', title: '等待', prompt: 'prompt A', setupError: '上次批次已中断' },
      { id: 'claimed', title: '生成中', prompt: 'prompt B', taskId: 'task-running' },
    ])
    expect(conversation.batchFinishedAt).toBeNull()
  })

  it('writes batchStartedAt before invoking the worker and refuses an already started conversation', async () => {
    const events: string[] = []
    const startBatch = helper('startAfternoonTeaConversationBatch')
    const update = (_id: string, patch: Partial<AfternoonTeaConversation>) => {
      if (patch.batchStartedAt != null) events.push(`started:${patch.batchStartedAt}`)
    }
    const run = async () => { events.push('run') }
    expect(await startBatch?.(afternoonTeaConversation(), update, run, () => 500)).toBe(true)
    expect(await startBatch?.(afternoonTeaConversation({ batchStartedAt: 500 }), update, run, () => 600)).toBe(false)
    expect(events).toEqual(['started:500', 'run'])
  })

  it('creates reload retry runtime from conversation source and current settings without mutating the conversation', () => {
    const source = afternoonTeaConversation({ batchStartedAt: 10, batchFinishedAt: 20, posterItems: [{ id: 'poster-a', title: '海报', prompt: 'prompt', taskId: 'missing-task' }] })
    const createRuntime = helper('createReloadAfternoonTeaBatchRuntime')
    const settings = afternoonTeaSettings()
    const original = JSON.parse(JSON.stringify(source))
    const runtime = createRuntime?.(source, 'data:image/png;base64,AQID', settings, { ...DEFAULT_PARAMS, n: 1 }) as {
      inputImage: { id: string; dataUrl: string }
      settingsSnapshot: AppSettings
      paramsSnapshot: { n: number }
      batchId: string
    } | null | undefined
    expect(runtime).toMatchObject({ batchId: source.id, inputImage: { id: 'source-a', dataUrl: 'data:image/png;base64,AQID' } })
    expect(runtime?.settingsSnapshot.profiles[0]?.apiKey).toBe('secret')
    expect(runtime?.paramsSnapshot.n).toBe(1)
    expect(source).toEqual(original)
    expect(source).not.toHaveProperty('apiKey')
  })

  it.each([
    ['busy', true, afternoonTeaConversation(), afternoonTeaSettings()],
    ['source missing', false, afternoonTeaConversation({ sourceImageId: null }), afternoonTeaSettings()],
    ['non-openai', false, afternoonTeaConversation(), afternoonTeaSettings(createDefaultFalProfile({ id: 'fal' }))],
    ['invalid config', false, afternoonTeaConversation(), afternoonTeaSettings(createDefaultOpenAIProfile({ id: 'openai', apiKey: '' }))],
  ])('disables reload retry for %s', (_label, busy, conversation, settings) => {
    const isDisabled = helper('isAfternoonTeaRetryDisabled')
    expect(isDisabled?.(busy, conversation, settings)).toBe(true)
  })

  it('executes TaskCard actions with gallery mode before reuse/edit and preserves confirm payload', () => {
    const events: string[] = []
    let confirmDialog: { title: string; message: string; action?: () => void } | null = null
    const createActions = helper('createAfternoonTeaTaskActions')
    const actions = createActions?.({
      setDetailTaskId: (id: string) => events.push(`detail:${id}`),
      setAppMode: (mode: string) => events.push(`mode:${mode}`),
      reuseConfig: async () => { events.push('reuse') },
      editOutputs: async () => { events.push('edit') },
      removeTask: async () => { events.push('remove') },
      setConfirmDialog: (dialog: { title: string; message: string; action?: () => void }) => {
        confirmDialog = dialog
        events.push('confirm')
        dialog.action?.()
      },
    }) as {
      onClick: (task: TaskRecord) => void
      onReuse: (task: TaskRecord) => void
      onEditOutputs: (task: TaskRecord) => void
      onDelete: (task: TaskRecord) => void
    } | undefined
    const task = { id: 'task-a' } as TaskRecord
    expect(actions).toBeTruthy()
    actions?.onClick(task)
    actions?.onReuse(task)
    actions?.onEditOutputs(task)
    actions?.onDelete(task)
    expect(events).toEqual(['detail:task-a', 'mode:gallery', 'reuse', 'mode:gallery', 'edit', 'confirm', 'remove'])
    expect(confirmDialog).toMatchObject({ title: '删除任务', message: expect.stringContaining('关联的图片资源') })
  })

  it('restores a historical conversation count without inventing a batch step', () => {
    const getRestoreState = helper('getAfternoonTeaConversationRestoreState')
    const restore = getRestoreState?.(afternoonTeaConversation({
      sourceImageId: null,
      sourceImageName: '',
      posterItems: [],
      batchStartedAt: null,
      batchFinishedAt: null,
    })) as {
      userPrompt: string
      systemPrompt: string
      titleCount: number
      imageName: string
      orderResult: AfternoonTeaConversation['orderResult']
      analysisSystemPromptSnapshot: string | null
      analysisUserPromptSnapshot: string | null
      step: 'order' | 'poster'
    } | undefined

    expect(restore).toMatchObject({
      userPrompt: '订单',
      systemPrompt: '系统',
      titleCount: 2,
      imageName: '',
      orderResult: expect.any(Object),
      analysisSystemPromptSnapshot: '分析系统',
      analysisUserPromptSnapshot: '分析用户',
      step: 'order',
    })
  })

  it('enters the poster step only for a conversation with a started batch', () => {
    const getRestoreState = helper('getAfternoonTeaConversationRestoreState')
    const restore = getRestoreState?.(afternoonTeaConversation({ batchStartedAt: 10 })) as { step: string } | undefined
    expect(restore?.step).toBe('poster')
  })

  it('builds the afternoon tea deletion preview from poster links and batch metadata', () => {
    const getPreview = helper('getAfternoonTeaHistoryDeletePreview')
    const preview = getPreview?.(afternoonTeaConversation({
      sourceImageId: 'source-a',
      posterItems: [{ id: 'poster-a', title: '海报', prompt: 'prompt', taskId: 'linked-task' }],
    }), [
      { id: 'linked-task', afternoonTeaBatchId: 'conversation-a', outputImages: ['output-a', 'output-b'] },
      { id: 'batch-task', afternoonTeaBatchId: 'conversation-a', outputImages: ['output-b'] },
      { id: 'other-task', outputImages: ['other-output'] },
    ] as TaskRecord[])

    expect(preview).toEqual({ relatedTaskIds: ['linked-task', 'batch-task'], generatedImageCount: 2, hasSourceImage: true })
  })

  it('blocks deletion while the conversation batch or one of its tasks is still running', () => {
    const isBusy = helper('isAfternoonTeaConversationBusy')
    expect(isBusy?.(afternoonTeaConversation({ batchStartedAt: 10, batchFinishedAt: null }), [])).toBe(true)
    expect(isBusy?.(afternoonTeaConversation({ batchStartedAt: 10, batchFinishedAt: 20 }), [
      { id: 'task-a', afternoonTeaBatchId: 'conversation-a', status: 'running' },
    ] as TaskRecord[])).toBe(true)
    expect(isBusy?.(afternoonTeaConversation({ batchStartedAt: 10, batchFinishedAt: 20 }), [])).toBe(false)
  })

  it('keeps retry disabled until a batch has a frozen finish boundary', () => {
    const isDisabled = helper('isAfternoonTeaRetryDisabled')
    expect(isDisabled?.(false, afternoonTeaConversation({ batchStartedAt: 10, batchFinishedAt: null }), afternoonTeaSettings())).toBe(true)
    expect(isDisabled?.(false, afternoonTeaConversation({ batchStartedAt: 10, batchFinishedAt: 20 }), afternoonTeaSettings())).toBe(false)
  })

  it('keeps the tool title on one line while overlaying its actions inside the same item', () => {
    const navSource = workspaceSource.slice(
      workspaceSource.indexOf('<nav className='),
      workspaceSource.indexOf('</nav>'),
    )

    expect(navSource).toMatch(
      /<div className="[^"]*relative[^"]*">[\s\S]*?<div[^>]*aria-current="page"[^>]*>[\s\S]*?餐品解析/,
    )
    expect(navSource).toMatch(
      /<div className="[^"]*absolute[^"]*right-[^"]*">[\s\S]*?<MessageCircleIcon[\s\S]*?<EditIcon/,
    )
    expect(navSource).toContain('hidden text-xs font-medium text-gray-400 sm:block')
    expect(navSource).toContain('flex h-14 items-center')
    expect(navSource).toContain('sm:block sm:h-auto')
    expect(navSource).toContain('aria-current="page"')
    expect(navSource.match(/className="[^"]*h-11 w-11[^"]*sm:h-9 sm:w-8[^"]*"/g)).toHaveLength(2)
    expect(navSource).toContain('aria-expanded={historyOpen}')
    expect(navSource).toContain('className="relative z-10')
    expect(navSource).toContain('<MessageCircleIcon className="h-5 w-5 sm:h-4 sm:w-4" />')
    expect(navSource).toContain('<EditIcon className="h-5 w-5 sm:h-4 sm:w-4" />')
    expect(navSource).not.toContain('translate-x-')
    expect(navSource).not.toContain('<HistoryIcon')
    expect(iconsSource).toContain('export function MessageCircleIcon')
    expect(iconsSource).toContain('M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29')
  })

  it('binds the tools navigation actions to the independent afternoon tea history flow', () => {
    expect(workspaceSource).toContain('<MessageCircleIcon')
    expect(workspaceSource).toContain('<EditIcon')
    expect(workspaceSource).toContain('<ConversationHistoryPopover')
    expect(workspaceSource).toContain('useDocumentImagePaste')
    expect(workspaceSource).toContain('files[0]')
    expect(workspaceSource).toContain('runtime.batchId !== activeConversation.id')
    expect(workspaceSource).toContain('ensureImageCached(activeConversation.sourceImageId)')
    expect(workspaceSource).toContain('activeAfternoonTeaConversationId === conversationId')
    expect(workspaceSource).toContain('isCurrentImageSelection(analysisRevision)')
    expect(workspaceSource).toContain('batchStartingConversationIdsRef.current.add')
    expect(workspaceSource).toContain('defaultSystemPromptRef.current = value')
    expect(workspaceSource).toContain('const retryDisabled = !imageDataUrl ||')
  })
})
