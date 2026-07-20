import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } from '../lib/apiProfiles'
import {
  DishAnalysisCoordinator,
  DishAnalysisFormView,
  MAX_DISH_IMAGE_BYTES,
  getDishAnalysisProfile,
  validateDishImageFile,
} from './ToolsWorkspace'
import appSource from '../App.tsx?raw'

const noop = () => {}

function renderForm(overrides: Partial<Parameters<typeof DishAnalysisFormView>[0]> = {}) {
  return renderToStaticMarkup(<DishAnalysisFormView
    configured
    imageDataUrl=""
    imageName=""
    userPrompt="请解析这张餐品图片"
    systemPrompt="你是餐品分析助手"
    output=""
    error=""
    loading={false}
    onImageChange={noop}
    onRemoveImage={noop}
    onUserPromptChange={noop}
    onSystemPromptChange={noop}
    onSubmit={noop}
    onCancel={noop}
    onClear={noop}
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
    expect(html).toContain('用户输入')
    expect(html).toContain('系统提示词')
    expect(html).toContain('文本输出')
    expect(html).toContain('开始解析')
  })

  it('renders configuration, loading, error, and result states', () => {
    expect(renderForm({ configured: false })).toContain('请先在 API 配置中选择 OpenAI 配置')
    expect(renderForm({ loading: true })).toContain('取消解析')
    expect(renderForm({ error: '请求失败' })).toContain('请求失败')
    expect(renderForm({ output: '解析结果', imageDataUrl: 'data:image/png;base64,AQID', imageName: 'dish.png' })).toContain('解析结果')
    expect(renderForm({ output: '解析结果' })).toContain('清空')
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
})
