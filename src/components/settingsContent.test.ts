import { describe, expect, it } from 'vitest'
import settingsModal from './SettingsModal.tsx?raw'

describe('settings content', () => {
  it('does not show the author sponsorship action', () => {
    expect(settingsModal).not.toContain('https://www.ifdian.net/a/cooksleep')
    expect(settingsModal).not.toContain('赞助作者')
  })

  it('shows separate Images API model fields and model discovery', () => {
    expect(settingsModal).toContain('生图模型 ID')
    expect(settingsModal).toContain('语义理解/多模态模型 ID')
    expect(settingsModal).toContain('获取模型列表')
    expect(settingsModal).toContain("activeProfile.apiMode === 'images'")
  })
})

  it('exposes multi-profile image generation parallel selection', () => {
    expect(settingsModal).toContain('生图将同时请求')
    expect(settingsModal).toContain('toggleImageGenerationProfile')
    expect(settingsModal).toContain('参与生图并行')
  })

