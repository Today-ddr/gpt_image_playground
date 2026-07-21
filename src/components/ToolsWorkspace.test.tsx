import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } from '../lib/apiProfiles'
import type { AfternoonTeaPosterBatchItem, TaskRecord } from '../types'
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
import workspaceSource from './ToolsWorkspace.tsx?raw'
import mockApiSource from '../../scripts/mock-image-api.mjs?raw'

const noop = () => {}

function renderForm(overrides: Partial<Parameters<typeof DishAnalysisFormView>[0]> = {}) {
  return renderToStaticMarkup(<DishAnalysisFormView
    configured
    imageDataUrl=""
    imageName=""
    userPrompt="请解析这张餐品图片"
    systemPrompt="你是餐品分析助手"
    titleCount={5}
    orderResult={null}
    error=""
    loading={false}
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
    expect(html).toContain('餐品图片（可选）')
    expect(html).toContain('下午茶订单')
    expect(html).toContain('系统提示词')
    expect(html).toContain('恢复默认')
    expect(html).toContain('解析结果')
    expect(html).toContain('开始解析')
    expect(html).toContain('生成数量')
    expect(html).toContain('min="1"')
    expect(html).toContain('max="10"')
    expect(html).toContain('value="5"')
  })

  it('renders configuration, loading, error, and result states', () => {
    expect(renderForm({ configured: false })).toContain('请先在 API 配置中选择 OpenAI 配置')
    expect(renderForm({ loading: true })).toContain('取消解析')
    expect(renderForm({ error: '请求失败' })).toContain('请求失败')
    const resultHtml = renderForm({
      imageDataUrl: 'data:image/png;base64,AQID',
      imageName: 'dish.png',
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
    const html = renderForm({ error: '下午茶订单解析结果格式无效' })
    expect(html).toContain('下午茶订单解析结果格式无效')
    expect(html).toContain('解析结果将显示在这里')
    expect(html).not.toContain('&quot;items&quot;')
  })

  it('disables parsing only when both image and order text are empty', () => {
    expect(renderForm({ imageDataUrl: '', userPrompt: '' })).toMatch(/<button[^>]*disabled=""[^>]*>开始解析<\/button>/)
    expect(renderForm({ imageDataUrl: 'data:image/png;base64,AQID', userPrompt: '' })).not.toMatch(/<button[^>]*disabled=""[^>]*>开始解析<\/button>/)
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
})

describe('dish analysis coordination', () => {
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
    expect(normalizeDishTitleCount(Number.NaN)).toBe(5)
  })

  it('rejects an empty image and order before any API request', () => {
    expect(() => validateDishAnalysisInput('', '   ')).toThrow('请上传餐品图片或填写下午茶订单')
    expect(() => validateDishAnalysisInput('data:image/png;base64,AQID', '   ')).not.toThrow()
    expect(() => validateDishAnalysisInput('', '今日茶歇')).not.toThrow()
    expect(workspaceSource).toContain('validateDishAnalysisInput(imageDataUrl, userPrompt)')
    expect(workspaceSource.indexOf('validateDishAnalysisInput(imageDataUrl, userPrompt)'))
      .toBeLessThan(workspaceSource.indexOf('await analyzeDish({'))
  })

  it('builds both dynamic prompts with the same state title count before submitting', () => {
    expect(workspaceSource).toContain('systemPrompt: buildDishAnalysisSystemPrompt(systemPrompt, titleCount)')
    expect(workspaceSource).toContain('userPrompt: buildDishAnalysisUserPrompt(userPrompt, titleCount)')
    expect(workspaceSource).toContain('parseAfternoonTeaOrderResult(raw, titleCount)')
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
    ], { 'image-first': 'data:image/png;base64,AQID' })

    expect(viewItems.map((item) => item.status)).toEqual(['queued', 'running', 'done', 'error', 'error'])
    expect(viewItems[2].outputSrc).toBe('data:image/png;base64,AQID')
    expect(viewItems[3].error).toContain('服务暂不可用')
    expect(viewItems[4].error).toBe('创建失败')
  })

  it('treats a missing linked task record as a retryable error', () => {
    const [viewItem] = deriveAfternoonTeaPosterViewItems([
      { id: 'missing', title: '记录丢失', prompt: 'prompt missing', taskId: 'task-missing' },
    ], [], {})

    expect(viewItem.status).toBe('error')
    expect(viewItem.error).toContain('任务记录不存在')
  })

  it('wires immutable generation snapshots and one cached source image into batch and retry', () => {
    expect(workspaceSource).toContain("storeImage(imageDataUrl, 'upload')")
    expect(workspaceSource).toContain('const settingsSnapshot = normalizeSettings(settings)')
    expect(workspaceSource).toContain('normalizeParamsForSettings({ ...params }, settingsSnapshot, { hasInputImages: true })')
    expect(workspaceSource).toContain('runAfternoonTeaPosterBatch({')
    expect(workspaceSource).toContain('retryAfternoonTeaPosterItem({')
    expect(workspaceSource).toContain('submit: submitAfternoonTeaPosterTask')
    expect(workspaceSource).toContain('if (mountedRef.current) setBatchPageError')
    expect(workspaceSource).toContain('batchRuntimeRef.current?.settingsSnapshot')
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
    const sourceSetup = startSource.slice(
      startSource.indexOf('await storeImage'),
      startSource.indexOf('cachedSourceImageRef.current ='),
    )

    expect(workspaceSource).toContain('const afternoonTeaBatchOperationId = useStore((state) => state.afternoonTeaBatchOperationId)')
    expect(workspaceSource).toContain('const batchBusy = Boolean(afternoonTeaBatchOperationId) || batchRunning || retrying')
    expect(startSource).toContain('if (!tryBeginAfternoonTeaBatchOperation(operationId)) return')
    expect(startSource.indexOf('tryBeginAfternoonTeaBatchOperation(operationId)'))
      .toBeLessThan(startSource.indexOf('await storeImage'))
    expect(sourceSetup).not.toContain('mountedRef.current')
    expect(startSource).toContain('if (mountedRef.current) setBatchStarted(true)')
    expect(retrySource).toContain('if (!tryBeginAfternoonTeaBatchOperation(operationId)) return')
    expect(retrySource.indexOf('tryBeginAfternoonTeaBatchOperation(operationId)'))
      .toBeLessThan(retrySource.indexOf('await retryAfternoonTeaPosterItem({'))
    expect(workspaceSource.match(/finishAfternoonTeaBatchOperation\(operationId\)/g)).toHaveLength(2)
    expect(workspaceSource.match(/if \(!mountedRef\.current\) return\n\s+if \(batchRuntimeRef\.current\?\.batchId !== currentBatchId\) return/g)).toHaveLength(4)
    expect(workspaceSource).not.toContain('batchCoordinatorRef.current.dispose()')
    expect(workspaceSource).not.toContain('disposeWhenIdle()')
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

  it('routes mock Chat Completions before image API fallbacks', () => {
    expect(mockApiSource).toContain("pathname.endsWith('/v1/chat/completions')")
    expect(mockApiSource).toContain('choices: [{ message: { content: JSON.stringify(result) } }]')
    expect(mockApiSource.indexOf('isOpenAIChatCompletionsPath(url.pathname)'))
      .toBeLessThan(mockApiSource.indexOf('isOpenAIImagesPath(url.pathname)'))
  })
})
