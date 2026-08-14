import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } from '../lib/apiProfiles'
import { AfternoonTeaBatchCoordinator } from '../lib/afternoonTeaBatch'
import { DEFAULT_DISH_TITLE_COUNT } from '../lib/dishAnalysisPrompts'
import { DEFAULT_AFTERNOON_TEA_TITLE_REGION } from '../lib/afternoonTeaTitlePlacement'
import { DEFAULT_PARAMS, type AfternoonTeaConversation, type AfternoonTeaPosterBatchItem, type AppSettings, type TaskRecord } from '../types'
import * as workspaceHelpers from './ToolsWorkspace'
import {
  DishAnalysisCoordinator,
  DishAnalysisFormView,
  MAX_DISH_IMAGE_BYTES,
  ToolsWorkflowSteps,
  deriveAfternoonTeaPosterViewItems,
  commitDishTitleCountDraft,
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
    itemTitleRegions: [{ ...DEFAULT_AFTERNOON_TEA_TITLE_REGION }],
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
    itemTitleRegions={[]}
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
    onPosterTitleChange={noop}
    onItemTitleRegionsChange={noop}
    onItemNameChange={noop}
    onItemTagsChange={noop}
    {...overrides}
  />)
}

describe('DishAnalysisFormView', () => {
  it('mounts the tools workspace from tools mode', () => {
    expect(appSource).toContain("appMode === 'tools' && <ToolsWorkspace />")
  })

  it('does not stretch the mobile tools navigation row to the full viewport height', () => {
    expect(workspaceSource).toContain('grid min-h-0 sm:min-h-[calc(100vh-8rem)]')
    expect(workspaceSource).not.toContain('min-h-[calc(100dvh-8rem)] sm:min-h-[calc(100vh-8rem)]')
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

  it('keeps the empty uploader compact and gives parsed images a wider frame', () => {
    expect(renderForm()).toMatch(/<label class="[^"]*md:max-w-48[^"]*"/)
    const previewHtml = renderForm({ imageDataUrl: 'data:image/png;base64,AQID' })
    expect(previewHtml).toMatch(/w-full max-w-none[^"]*md:max-w-48/)
    const parsedHtml = renderForm({
      imageDataUrl: 'data:image/png;base64,AQID',
      orderResult: { titles: ['今日下午茶'], items: [{ displayName: '草莓蛋糕', tags: [] }] },
    })
    expect(parsedHtml).toContain('aria-label="订单商品位置设置"')
    expect(parsedHtml).not.toMatch(/md:max-w-48/)
  })

  it('keeps the parsed image area together with placement and remove controls', () => {
    const html = renderForm({
      imageDataUrl: 'data:image/png;base64,AQID',
      orderResult: {
        titles: ['今日下午茶'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
    })
    const imageStart = html.indexOf('>餐品图片</')
    const imageEnd = html.indexOf('系统提示词', imageStart)
    const imageArea = html.slice(imageStart, imageEnd)
    const placementCount = html.match(/aria-label="订单商品位置设置"/g) ?? []

    expect(imageStart).toBeGreaterThan(-1)
    expect(imageEnd).toBeGreaterThan(imageStart)
    expect(imageArea).toContain('aria-label="移除餐品图片"')
    expect(imageArea).toContain('aria-label="订单商品位置设置"')
    expect(imageArea).toContain('图片加载中')
    expect(imageArea.indexOf('移除餐品图片')).toBeLessThan(imageArea.indexOf('订单商品位置设置'))
    expect(placementCount).toHaveLength(1)

    const placementStart = html.indexOf('aria-label="订单商品位置设置"')
    const placementEnd = html.indexOf('</section>', placementStart)
    expect(html.slice(placementStart, placementEnd)).not.toContain('移除餐品图片')
  })

  it('gives every desktop poster title an explicit edit action', () => {
    const html = renderForm({
      orderResult: {
        titles: ['今日下午茶', '暖心时光'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
    })

    expect(html).toContain('aria-label="编辑海报标题 1"')
    expect(html).toContain('aria-label="编辑海报标题 2"')
    expect(html).toContain('海报标题可修改')
  })

  it('offers touch-sized camera and upload actions on mobile', () => {
    const html = renderForm()

    expect(html).toContain('grid grid-cols-2 gap-2 md:hidden')
    expect(html).toMatch(/<label class="[^"]*min-h-11[^"]*">[\s\S]*?拍照[\s\S]*?<input[^>]*capture="environment"[^>]*aria-label="拍照"/)
    expect(html).toMatch(/<label class="[^"]*min-h-11[^"]*">[\s\S]*?上传图片[\s\S]*?<input[^>]*aria-label="上传餐品图片"/)
    expect(html).toMatch(/class="[^"]*hidden[^"]*md:flex[^"]*"/)
    expect(iconsSource).toContain('export function CameraIcon')
  })

  it('overlays the remove action without a filename footer', () => {
    const html = renderForm({ imageDataUrl: 'data:image/png;base64,AQID' })
    const propsSource = workspaceSource.slice(
      workspaceSource.indexOf('type DishAnalysisFormViewProps = {'),
      workspaceSource.indexOf('type ToolsWorkflowStepsProps = {'),
    )
    const callStart = workspaceSource.indexOf('<AfternoonTeaMobileWorkflow')
    const callSource = workspaceSource.slice(callStart, workspaceSource.indexOf('/>', callStart) + 2)

    expect(html).toContain('aria-label="移除餐品图片"')
    expect(html).toMatch(/<button[^>]*class="[^"]*absolute right-2 top-2[^"]*"/)
    const removeButtonClass = html.match(/<button[^>]*class="([^"]*absolute right-2 top-2[^"]*)"[^>]*aria-label="移除餐品图片"/)?.[1] ?? ''
    expect(removeButtonClass.split(/\s+/)).not.toContainEqual(expect.stringMatching(/^(?:[^:]+:)*-?z-/))
    expect(html).toContain('h-11 w-11')
    expect(html).toContain('sm:h-7 sm:w-7')
    expect(html).toContain('focus-visible:')
    expect(html).not.toContain('border-t')
    expect(propsSource).not.toContain('imageName')
    expect(callSource).not.toContain('imageName')
  })

  it('groups the image with the order and keeps advanced settings collapsed', () => {
    const html = renderForm()

    expect(html).toContain('grid items-start gap-3 sm:gap-4 md:grid-cols-[192px_minmax(0,1fr)]')
    expect(html.indexOf('餐品图片')).toBeLessThan(html.indexOf('下午茶订单'))
    expect(html).toContain('md:col-start-2 md:row-start-1')
    expect(html).toContain('md:col-start-1 md:row-start-1')
    expect(html).toContain('order-1')
    expect(html).toContain('order-2')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toMatch(/<summary[^>]*>[\s\S]*系统提示词[\s\S]*高级设置[\s\S]*<\/summary>/)
  })

  it('remounts local input drafts when the active conversation changes', () => {
    const callStart = workspaceSource.indexOf('<AfternoonTeaMobileWorkflow')
    const callSource = workspaceSource.slice(callStart, workspaceSource.indexOf('/>', callStart) + 2)

    expect(callSource).toContain("key={activeConversation?.id ?? 'no-afternoon-tea-conversation'}")
  })

  it('keeps the outer workflow stacked until the wider parsed input grid fits', () => {
    expect(workspaceSource).toContain('grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]')
    expect(workspaceSource).not.toContain('grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]')
  })

  it('keeps the parsed image and order stacked on mobile and side-by-side on large screens', () => {
    const html = renderForm({
      imageDataUrl: 'data:image/png;base64,AQID',
      orderResult: {
        titles: ['今日下午茶'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
    })

    expect(html).toContain('lg:grid-cols-[minmax(280px,1.2fr)_minmax(220px,0.8fr)]')
    expect(html).toContain('order-1 min-w-0 lg:col-start-1 lg:row-start-1')
    expect(html).toContain('order-2 block min-w-0 lg:col-start-2 lg:row-start-1')
    expect(html).not.toContain('md:grid-cols-[minmax(280px,1.2fr)_minmax(220px,0.8fr)]')
    expect(html).toContain('aria-label="订单商品位置设置"')
  })

  it('places title count and parsing controls in one action bar', () => {
    const html = renderForm()

    expect(html).toMatch(/aria-label="解析操作"[\s\S]*生成数量[\s\S]*开始解析/)
    expect(html).toContain('grid grid-cols-1 gap-2 sm:flex')
    expect(html).toContain('grid grid-cols-2 gap-2 sm:ml-auto')
    expect(html).toContain('min-h-0')
    expect(html).toContain('lg:min-h-[360px]')
  })

  it('keeps an empty title count draft until blur or Enter commits it', () => {
    expect(commitDishTitleCountDraft('', 4)).toBe(4)
    expect(commitDishTitleCountDraft('4', 1)).toBe(4)
    expect(commitDishTitleCountDraft('e', 7)).toBe(7)
    expect(commitDishTitleCountDraft('Infinity', 7)).toBe(7)
    expect(commitDishTitleCountDraft('0', 4)).toBe(1)
    expect(commitDishTitleCountDraft('12', 4)).toBe(10)
    expect(workspaceSource).toContain('const [titleCountDraft, setTitleCountDraft] = useState(String(props.titleCount))')
    expect(workspaceSource).toContain('value={titleCountDraft}')
    expect(workspaceSource).not.toContain('onChange={(event) => props.onTitleCountChange(normalizeDishTitleCount(Number(event.target.value)))}')
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

  it('renders one editable name and one draggable box for every order product', () => {
    const orderResult = {
      titles: ['今日下午茶'],
      items: [
        { displayName: '蟹肉沙拉紫菜包饭', tags: ['蟹肉'] },
        { displayName: '金枪鱼紫菜包饭', tags: ['金枪鱼'] },
        { displayName: '蛋黄肉松紫菜包饭', tags: ['蛋黄', '肉松'] },
      ],
    }
    const html = renderForm({ imageDataUrl: 'data:image/png;base64,AQID', orderResult })
    const lockedHtml = renderForm({ imageDataUrl: 'data:image/png;base64,AQID', orderResult, locked: true })

    expect((html.match(/data-order-item-name=/g) ?? [])).toHaveLength(3)
    expect((html.match(/data-item-title-box=/g) ?? [])).toHaveLength(3)
    expect(html).toContain('蟹肉沙拉紫菜包饭')
    expect(html).toContain('金枪鱼紫菜包饭')
    expect(html).toContain('蛋黄肉松紫菜包饭')
    expect(html).toContain('名称可修改')
    expect(html.match(/<input[^>]*data-order-item-name="0"[^>]*>/)?.[0]).toContain('min-h-10')
    expect(lockedHtml).toMatch(/<input[^>]*disabled=""[^>]*data-order-item-name="0"/)
    expect(lockedHtml).toContain('已锁定')
  })

  it('offers deferred tag editing, adding, and removal for every order product', () => {
    const html = renderForm({
      imageDataUrl: 'data:image/png;base64,AQID',
      orderResult: {
        titles: ['今日下午茶'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓', '奶油'] }],
      },
    })

    expect((html.match(/data-order-item-tag=/g) ?? [])).toHaveLength(2)
    expect(html).toContain('aria-label="商品 1 新增标签"')
    expect(html).not.toContain('placeholder="新增标签"')
    expect(html).toContain('删除商品 1 标签 草莓')
    expect(workspaceSource).toContain('onItemTagsChange: (index: number, tags: string[]) => void')
    expect(workspaceSource).toContain('createAfternoonTeaOrderItemTagsPatch(conversation, index, tags)')
    expect(workspaceSource).toContain('key={tagIndex}')
    expect(workspaceSource).not.toContain('<span key={`${tag}-${tagIndex}`}')
    expect(workspaceSource).toContain('data-order-item-new-tag={idx}')
    expect(workspaceSource).toContain('setAddingTagIndexes')
  })

  it('keeps tag chips compact with a plus icon for adding tags', () => {
    const html = renderForm({
      imageDataUrl: 'data:image/png;base64,AQID',
      orderResult: {
        titles: ['今日下午茶'],
        items: [{ displayName: '草莓蛋糕', tags: ['草莓'] }],
      },
    })

    expect(html).toMatch(/<div class="[^"]*flex[^"]*min-w-0[^"]*flex-wrap[^"]*"/)
    expect(html).toMatch(/<span class="[^"]*rounded-full[^"]*"/)
    expect(html).toMatch(/<input[^>]*data-order-item-tag="0-0"[^>]*class="[^"]*text-xs[^"]*"/)
    expect(html).toMatch(/<button[^>]*aria-label="删除商品 1 标签 草莓"[^>]*class="[^"]*h-5 w-5[^"]*"/)
    expect(html).toContain('invisible')
    expect(html).toContain('inline-grid')
    expect(html).toMatch(/<input[^>]*data-order-item-tag="0-0"[^>]*>/)
    expect(html.match(/<input[^>]*data-order-item-tag="0-0"[^>]*>/)?.[0]).toContain('size="1"')
    expect(html).toContain('w-fit')
    expect(workspaceSource).toContain('[field-sizing:content]')
    expect(workspaceSource).toContain('size={1}')
    expect(html).toMatch(/<button[^>]*aria-label="商品 1 新增标签"[^>]*class="[^"]*h-7 w-7[^"]*"/)
    expect(html).toContain('M5 12h14')
    expect(html).toContain('M12 5v14')
    expect(iconsSource).toContain('export function PlusIcon')
    expect(iconsSource).toContain('M5 12h14')
    expect(iconsSource).toContain('M12 5v14')
  })

  it('does not commit a product name while an IME is composing', () => {
    expect(workspaceSource).toContain('event.nativeEvent.isComposing')
    expect(workspaceSource).toContain('event.nativeEvent.keyCode === 229')
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
      { id: 'setup-linked', title: '创建后失败', prompt: 'prompt setup linked', taskId: 'task-setup', setupError: '创建后失败' },
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
      task('task-setup', 'running'),
    ])

    expect(viewItems.map((item) => item.status)).toEqual(['queued', 'running', 'done', 'error', 'error', 'error'])
    expect(viewItems[2].task?.id).toBe('task-done')
    expect(viewItems[3].error).toContain('服务暂不可用')
    expect(viewItems[4].error).toBe('创建失败')
    expect(viewItems[5]).toMatchObject({ error: '创建后失败', task: { id: 'task-setup' } })
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
    expect(workspaceSource).toContain('readAfternoonTeaPosterSourceSize(sourceImage)')
    expect(workspaceSource).toContain('createAfternoonTeaPosterParamsSnapshot(state.params, settingsSnapshot, sourceImageSize)')
    expect(workspaceSource).not.toContain('normalizeParamsForSettings({ ...state.params }, settingsSnapshot, { hasInputImages: true })')
    expect(workspaceSource).toContain('runAfternoonTeaPosterBatch({')
    expect(workspaceSource).toContain('retryAfternoonTeaPosterItem({')
    expect(workspaceSource).toContain('submit: submitAfternoonTeaPosterTask')
    expect(workspaceSource).toContain('mountedRef.current && useStore.getState().activeAfternoonTeaConversationId === conversationId')
    expect(workspaceSource).toContain('batchId: conversationId')
    expect(workspaceSource).toContain('updateAfternoonTeaConversation(conversationId')
    expect(workspaceSource).toContain('busy={batchBusy || loading}')
  })

  it('commits product placement and names only for the active editable conversation', () => {
    const handlerStart = workspaceSource.indexOf('const updateItemTitleRegions = (conversationId: string, itemTitleRegions: AfternoonTeaTitleRegion[]) => {')
    const handlerEnd = workspaceSource.indexOf('const reparse = () => {', handlerStart)
    const handlerSource = workspaceSource.slice(handlerStart, handlerEnd)
    const callStart = workspaceSource.indexOf('<AfternoonTeaMobileWorkflow')
    const callSource = workspaceSource.slice(callStart, workspaceSource.indexOf('/>', callStart) + 2)

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerSource).toContain('state.activeAfternoonTeaConversationId !== conversationId')
    expect(handlerSource).toContain('state.afternoonTeaBatchOperationId')
    expect(handlerSource).toContain('batchStartingConversationIdsRef.current.has(conversationId)')
    expect(handlerSource).toContain('createAfternoonTeaItemTitleRegionsPatch(conversation, itemTitleRegions)')
    expect(workspaceSource).toContain('createAfternoonTeaOrderItemNamePatch(conversation, index, displayName)')
    expect(handlerSource).toContain('state.updateAfternoonTeaConversation(conversation.id, patch)')
    expect(callSource).toContain('itemTitleRegions={activeConversation?.itemTitleRegions ?? []}')
    expect(callSource).toContain('updateItemTitleRegions(activeConversation.id, regions)')
    expect(callSource).toContain('updateItemName(activeConversation.id, index, displayName)')
  })

  it('freezes the latest product names and regions before starting generation', () => {
    const prepareStart = workspaceSource.indexOf('const prepareAfternoonTeaPosterItems = () => {')
    const prepareSource = workspaceSource.slice(prepareStart, workspaceSource.indexOf('const handleNewConversation', prepareStart))

    expect(prepareStart).toBeGreaterThan(-1)
    expect(prepareSource).toContain('const state = useStore.getState()')
    expect(prepareSource).toContain('const conversation = state.afternoonTeaConversations.find')
    expect(prepareSource).toContain('const itemTitleRegions = normalizeAfternoonTeaItemTitleRegions(')
    expect(prepareSource).toContain('const prompts = buildAfternoonTeaPosterPrompts(conversation.orderResult, itemTitleRegions)')
    expect(prepareSource).toContain('state.updateAfternoonTeaConversation(conversation.id, { itemTitleRegions, posterItems })')
    expect(prepareSource).toContain('if (existing?.taskId || existing?.setupError) return existing')
    expect(prepareSource).not.toContain('setStep')
  })

  it('holds one global operation lease across source setup, batch run, and retry', () => {
    const startSource = workspaceSource.slice(
      workspaceSource.indexOf('const startBatch = async () => {'),
      workspaceSource.indexOf('const retryItem = async (itemId: string, taskId?: string) => {'),
    )
    const retrySource = workspaceSource.slice(
      workspaceSource.indexOf('const retryItem = async (itemId: string, taskId?: string) => {'),
      workspaceSource.indexOf('const updateUserPrompt = (conversationId: string | null, value: string) => {'),
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

  it('rejects delayed menu writes after the active conversation changes', () => {
    const handlerStart = workspaceSource.indexOf('const updateUserPrompt = (conversationId: string | null, value: string) => {')
    const handlerSource = workspaceSource.slice(handlerStart, workspaceSource.indexOf('const updateTitleCount', handlerStart))
    const callStart = workspaceSource.indexOf('<AfternoonTeaMobileWorkflow')
    const callSource = workspaceSource.slice(callStart, workspaceSource.indexOf('/>', callStart) + 2)

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerSource).toContain('const state = useStore.getState()')
    expect(handlerSource).toContain('state.activeAfternoonTeaConversationId !== conversationId')
    expect(handlerSource).toContain('currentConversation.orderText === value')
    expect(callSource).toContain('updateUserPrompt(activeConversation?.id ?? null, value)')
  })

  it('mounts one shared continuous workflow without viewport branching or legacy steps', () => {
    const renderStart = workspaceSource.indexOf('<div className="min-w-0">')
    const renderSource = workspaceSource.slice(renderStart, workspaceSource.indexOf('</main>', renderStart))
    const confirmStart = workspaceSource.indexOf('const confirmAndGenerate = () => {')
    const confirmSource = workspaceSource.slice(confirmStart, workspaceSource.indexOf('const handleNewConversation', confirmStart))

    expect(workspaceSource).not.toContain('useIsMobileToolsWorkflow')
    expect(workspaceSource).not.toContain("window.matchMedia('(max-width: 639px)')")
    expect(workspaceSource).not.toContain("useState<'order' | 'poster'>")
    expect((renderSource.match(/<AfternoonTeaMobileWorkflow\b/g) ?? [])).toHaveLength(1)
    expect(renderSource).not.toContain('isMobileToolsWorkflow ?')
    expect(renderSource).not.toContain('<ToolsWorkflowSteps')
    expect(renderSource).not.toContain('<DishAnalysisFormView')
    expect(renderSource).not.toContain('<AfternoonTeaPosterStep')
    expect(confirmSource.indexOf('prepareAfternoonTeaPosterItems()')).toBeLessThan(confirmSource.indexOf('void startBatch()'))
    expect(renderSource).toContain('onConfirmAndGenerate={confirmAndGenerate}')
  })

  it('applies mobile poster titles atomically before starting the batch', () => {
    const handlerStart = workspaceSource.indexOf('const updatePosterTitles = (conversationId: string, titles: string[]) => {')
    const handlerSource = workspaceSource.slice(handlerStart, workspaceSource.indexOf('const updateItemTags', handlerStart))
    const mobileStart = workspaceSource.indexOf('<AfternoonTeaMobileWorkflow')
    const mobileSource = workspaceSource.slice(mobileStart, workspaceSource.indexOf('/>', mobileStart) + 2)

    expect(workspaceSource).toContain('createAfternoonTeaOrderTitlesPatch,')
    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerSource).toContain('const state = useStore.getState()')
    expect(handlerSource).toContain('createAfternoonTeaOrderTitlesPatch(conversation, titles)')
    expect(handlerSource).toContain('state.updateAfternoonTeaConversation(conversation.id, patch)')
    expect(mobileSource).toContain('onPosterTitlesChange={(titles) => {')
    expect(mobileSource).toContain('updatePosterTitles(activeConversation.id, titles)')
  })

  it('starts a batch from the latest Zustand conversation after mobile drafts flush', () => {
    const startSource = workspaceSource.slice(
      workspaceSource.indexOf('const startBatch = async () => {'),
      workspaceSource.indexOf('const retryItem = async (itemId: string, taskId?: string) => {'),
    )
    const stateReadIndex = startSource.indexOf('const state = useStore.getState()')
    const conversationReadIndex = startSource.indexOf('state.afternoonTeaConversations.find')
    const operationIndex = startSource.indexOf('tryBeginAfternoonTeaBatchOperation(operationId)')

    expect(stateReadIndex).toBeGreaterThan(-1)
    expect(conversationReadIndex).toBeGreaterThan(stateReadIndex)
    expect(operationIndex).toBeGreaterThan(conversationReadIndex)
    expect(startSource).toContain('state.activeAfternoonTeaConversationId')
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

  it('skips the cloned conversation restore without resetting a second workflow step', () => {
    const cloneSource = workspaceSource.slice(
      workspaceSource.indexOf('const createEditableConversationFrom ='),
      workspaceSource.indexOf('const initializeNewConversationPrompt ='),
    )

    expect(cloneSource).not.toContain('setStep')
    expect(cloneSource).toContain('coordinatorRef.current.skipNextRestore(conversationId)')
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

  it('creates reload retry runtime with the source image size without mutating the conversation', async () => {
    const source = afternoonTeaConversation({ batchStartedAt: 10, batchFinishedAt: 20, posterItems: [{ id: 'poster-a', title: '海报', prompt: 'prompt', taskId: 'missing-task' }] })
    const createRuntime = helper('createReloadAfternoonTeaBatchRuntime')
    const settings = afternoonTeaSettings()
    const original = JSON.parse(JSON.stringify(source))
    const runtime = await createRuntime?.(
      source,
      'data:image/png;base64,AQID',
      settings,
      { ...DEFAULT_PARAMS, size: '1920x1080', n: 1 },
      [],
      { width: 3024, height: 4032 },
    ) as {
      inputImage: { id: string; dataUrl: string }
      settingsSnapshot: AppSettings
      paramsSnapshot: { n: number; size: string }
      batchId: string
    } | null | undefined
    expect(runtime).toMatchObject({ batchId: source.id, inputImage: { id: 'source-a', dataUrl: 'data:image/png;base64,AQID' } })
    expect(runtime?.settingsSnapshot.profiles[0]?.apiKey).toBe('secret')
    expect(runtime?.paramsSnapshot.n).toBe(1)
    expect(runtime?.paramsSnapshot.size).not.toBe('1920x1080')
    expect(Number(runtime?.paramsSnapshot.size.split('x')[0]) / Number(runtime?.paramsSnapshot.size.split('x')[1])).toBeCloseTo(3 / 4, 2)
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
    } | undefined

    expect(restore).toMatchObject({
      userPrompt: '订单',
      systemPrompt: '系统',
      titleCount: 2,
      imageName: '',
      orderResult: expect.any(Object),
      analysisSystemPromptSnapshot: '分析系统',
      analysisUserPromptSnapshot: '分析用户',
    })
    expect(restore).not.toHaveProperty('step')
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
    expect(navSource).toContain('flex h-12 items-center')
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
    expect(workspaceSource).toContain('createAfternoonTeaSourceImagePatch')
    expect(workspaceSource).toContain('batchStartingConversationIdsRef.current.add')
    expect(workspaceSource).toContain('defaultSystemPromptRef.current = value')
    expect(workspaceSource).toContain('const retryDisabled = !imageDataUrl ||')
  })

  it('keeps parsed results when a source image is attached later', () => {
    const handleStart = workspaceSource.indexOf('const handleImageChange = async')
    const handleSource = workspaceSource.slice(handleStart, workspaceSource.indexOf('const removeImage ='))
    const removeStart = workspaceSource.indexOf('const removeImage = () => {')
    const removeSource = workspaceSource.slice(removeStart, workspaceSource.indexOf('const submit = async'))
    const submitStart = workspaceSource.indexOf('const submit = async () => {')
    const submitSource = workspaceSource.slice(submitStart, workspaceSource.indexOf('const clear = () => {'))
    const pasteStart = workspaceSource.indexOf('useDocumentImagePaste(')
    const pasteSource = workspaceSource.slice(pasteStart, workspaceSource.indexOf('return (', pasteStart))

    expect(handleStart).toBeGreaterThan(-1)
    expect(handleSource).not.toContain('resetParsedResult')
    expect(handleSource).not.toContain('cancelRequest')
    expect(handleSource).toContain('ensureImageEditableConversation()')
    expect(handleSource).not.toContain('ensureEditableConversation()')
    expect(handleSource).toContain('createAfternoonTeaSourceImagePatch(latestConversation, image.id, file.name)')
    expect(removeSource).not.toContain('resetParsedResult')
    expect(removeSource).not.toContain('cancelRequest')
    expect(removeSource).toContain('ensureImageEditableConversation()')
    expect(removeSource).toContain('createAfternoonTeaSourceImagePatch(conversation, null, \'\')')
    expect(submitSource).not.toContain('beginImageSelection()')
    expect(submitSource).not.toContain('isCurrentImageSelection')
    expect(submitSource).toContain('latestSourceImageId')
    expect(pasteSource).toContain('imageLoading || batchBusy || Boolean(confirmDialog)')
    expect(pasteSource).not.toContain('imageLoading || loading ||')
    expect(workspaceSource).toContain('keepParsedResult: true')
  })
})
