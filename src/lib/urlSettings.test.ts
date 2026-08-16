import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultFalProfile,
  createDefaultOpenAIProfile,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from './apiProfiles'
import {
  buildSettingsFromUrlParams,
  clearUrlSettingParams,
  countNewStationProfilesAfterImport,
  createStationShareClipboardText,
  createStationSharePayload,
  createStationShareUrl,
  getAppModeFromUrlParams,
  hasUrlSettingParams,
  parseStationShareText,
  setAppModeUrlParams,
  setOpenAIProfileImportUrlParams,
  STATION_SHARE_URL_MAX_LENGTH,
} from './urlSettings'
import appSource from '../App.tsx?raw'
import mainSource from '../main.tsx?raw'
import settingsModalSource from '../components/SettingsModal.tsx?raw'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function importDefaultConfigOnlyUrlSettings() {
  vi.resetModules()
  vi.stubEnv('VITE_SHOW_DEFAULT_CONFIG_ONLY', 'true')
  vi.stubEnv('VITE_DEFAULT_API_URL', 'https://default.example.com/v1')
  return import('./urlSettings')
}

describe('URL settings params', () => {
  it('uses the appMode URL marker for tools without persisting other modes in the URL', () => {
    const params = new URLSearchParams('appMode=tools&foo=bar')

    expect(getAppModeFromUrlParams(params)).toBe('tools')
    expect(getAppModeFromUrlParams(new URLSearchParams('appMode=gallery'))).toBeNull()
    expect(getAppModeFromUrlParams(new URLSearchParams('appMode=invalid'))).toBeNull()

    setAppModeUrlParams(params, 'gallery')
    expect(params.get('foo')).toBe('bar')
    expect(params.has('appMode')).toBe(false)

    setAppModeUrlParams(params, 'tools')
    expect(params.get('appMode')).toBe('tools')
  })

  it('wires URL mode bootstrap before render and synchronizes mode changes with replaceState', () => {
    expect(mainSource).toContain('getAppModeFromUrlParams')
    expect(mainSource).toContain('useStore.getState().setAppMode(initialAppMode)')
    expect(appSource).toContain('setAppModeUrlParams(searchParams, appMode)')
    expect(appSource).toContain('window.history.replaceState')
  })

  it('writes and reads the understanding model for OpenAI profile URLs', () => {
    const params = new URLSearchParams()
    setOpenAIProfileImportUrlParams(params, createDefaultOpenAIProfile({
      model: 'gpt-image-1',
      understandingModel: 'gpt-4.1-mini',
    }))

    expect(params.get('understandingModel')).toBe('gpt-4.1-mini')

    const current = normalizeSettings(DEFAULT_SETTINGS)
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams(`apiUrl=https://api.example.com/v1&apiKey=test-key&${params}`)),
    })
    expect(next.profiles.find((profile) => profile.id === next.activeProfileId)?.understandingModel).toBe('gpt-4.1-mini')
  })

  it('creates and activates a new OpenAI profile for legacy URL params', () => {
    const current = normalizeSettings(DEFAULT_SETTINGS)
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1&apiKey=test-key')),
    })

    expect(next.profiles).toHaveLength(2)
    expect(next.activeProfileId).not.toBe(current.activeProfileId)
    expect(next.profiles.find((profile) => profile.id === next.activeProfileId)).toMatchObject({
      name: 'URL 参数配置',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: DEFAULT_IMAGES_MODEL,
    })
  })

  it('uses model from URL params for OpenAI profiles', () => {
    const current = normalizeSettings(DEFAULT_SETTINGS)
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1&apiKey=test-key&model=custom-image-model')),
    })

    expect(next.profiles.find((profile) => profile.id === next.activeProfileId)).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'custom-image-model',
      apiMode: 'images',
    })
  })

  it('uses profile name from URL params for OpenAI profiles', () => {
    const current = normalizeSettings(DEFAULT_SETTINGS)
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1&apiKey=test-key&profileName=测试配置')),
    })

    expect(next.profiles.find((profile) => profile.id === next.activeProfileId)).toMatchObject({
      name: '测试配置',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
    })
  })

  it('does not create a duplicate profile for matching legacy URL params', () => {
    const existingProfile = createDefaultOpenAIProfile({
      id: 'existing-openai',
      name: 'Existing OpenAI',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
    })
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [createDefaultOpenAIProfile(), existingProfile],
      activeProfileId: DEFAULT_SETTINGS.activeProfileId,
    })
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1/&apiKey=test-key')),
    })

    expect(next.profiles).toHaveLength(2)
    expect(next.activeProfileId).toBe(existingProfile.id)
  })

  it('creates a separate profile when URL profile name differs', () => {
    const existingProfile = createDefaultOpenAIProfile({
      id: 'existing-openai',
      name: 'Existing OpenAI',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
    })
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [createDefaultOpenAIProfile(), existingProfile],
      activeProfileId: DEFAULT_SETTINGS.activeProfileId,
    })
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1/&apiKey=test-key&profileName=URL Profile')),
    })
    const activeProfile = next.profiles.find((profile) => profile.id === next.activeProfileId)

    expect(next.profiles).toHaveLength(3)
    expect(next.activeProfileId).not.toBe(existingProfile.id)
    expect(activeProfile).toMatchObject({
      name: 'URL Profile',
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
    })
  })

  it('creates a separate profile when URL codex CLI option differs', () => {
    const existingProfile = createDefaultOpenAIProfile({
      id: 'existing-openai',
      name: 'Existing OpenAI',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      codexCli: false,
    })
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [createDefaultOpenAIProfile(), existingProfile],
      activeProfileId: DEFAULT_SETTINGS.activeProfileId,
    })
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1/&apiKey=test-key&codexCli=true')),
    })
    const activeProfile = next.profiles.find((profile) => profile.id === next.activeProfileId)

    expect(next.profiles).toHaveLength(3)
    expect(next.activeProfileId).not.toBe(existingProfile.id)
    expect(activeProfile).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      codexCli: true,
    })
  })

  it('creates a separate profile when URL streaming options differ', () => {
    const existingProfile = createDefaultOpenAIProfile({
      id: 'existing-openai',
      name: 'Existing OpenAI',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      streamImages: true,
      streamPartialImages: 0,
    })
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [createDefaultOpenAIProfile(), existingProfile],
      activeProfileId: DEFAULT_SETTINGS.activeProfileId,
    })
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1/&apiKey=test-key&streamImages=true&streamPartialImages=3')),
    })
    const activeProfile = next.profiles.find((profile) => profile.id === next.activeProfileId)

    expect(next.profiles).toHaveLength(3)
    expect(next.activeProfileId).not.toBe(existingProfile.id)
    expect(activeProfile).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      streamImages: true,
      streamPartialImages: 3,
    })
  })

  it('creates an OpenAI profile from legacy params even when fal is active', () => {
    const falProfile = createDefaultFalProfile({ id: 'fal-active', apiKey: 'fal-key' })
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1&apiKey=openai-key')),
    })

    expect(next.profiles).toHaveLength(2)
    expect(next.profiles.find((profile) => profile.id === next.activeProfileId)).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'openai-key',
    })
  })

  it('clears known URL setting params without touching unrelated params', () => {
    const params = new URLSearchParams('appMode=tools&apiUrl=https://api.example.com/v1&apiKey=test-key&model=test-model&profileName=test-profile&streamImages=false&streamPartialImages=3&foo=bar')

    expect(hasUrlSettingParams(params)).toBe(true)
    clearUrlSettingParams(params)

    expect(params.toString()).toBe('appMode=tools&foo=bar')
  })

  it('imports settings with custom providers from URL params', () => {
    const importedSettings = {
      customProviders: [{
        id: 'custom-json',
        name: 'Custom JSON',
        submit: {
          path: 'images/generations',
          method: 'POST',
          contentType: 'json',
          body: { model: '$profile.model', prompt: '$prompt' },
          result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
        },
      }],
      profiles: [{
        id: 'custom-profile',
        name: 'Custom Profile',
        provider: 'custom-json',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'custom-key',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
    }
    const params = new URLSearchParams()
    params.set('settings', JSON.stringify(importedSettings))

    const next = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...buildSettingsFromUrlParams(DEFAULT_SETTINGS, params),
    })

    expect(next.customProviders).toHaveLength(1)
    expect(next.customProviders[0]).toMatchObject({ id: 'custom-json', name: 'Custom JSON' })
    expect(next.activeProfileId).toBe('custom-profile')
    expect(next.profiles[0]).toMatchObject({
      id: 'custom-profile',
      provider: 'custom-json',
      apiKey: 'custom-key',
      model: 'custom-model',
    })
  })

  it('activates the first profile imported from URL settings when current settings are customized', () => {
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [createDefaultOpenAIProfile({
        id: 'current-openai',
        name: 'Current OpenAI',
        baseUrl: 'https://current.example.com/v1',
        apiKey: 'current-key',
        model: 'current-model',
      })],
      activeProfileId: 'current-openai',
    })
    const importedSettings = {
      customProviders: [{
        id: 'custom-json',
        name: 'Custom JSON',
        submit: {
          path: 'images/generations',
          method: 'POST',
          contentType: 'json',
          body: { model: '$profile.model', prompt: '$prompt' },
          result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
        },
      }],
      profiles: [{
        id: 'custom-profile',
        name: 'Custom Profile',
        provider: 'custom-json',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'custom-key',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
    }
    const params = new URLSearchParams()
    params.set('settings', JSON.stringify(importedSettings))

    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, params),
    })
    const activeProfile = next.profiles.find((profile) => profile.id === next.activeProfileId)

    expect(next.activeProfileId).not.toBe('current-openai')
    expect(activeProfile).toMatchObject({
      provider: 'custom-json',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
    })
  })

  it('imports custom provider settings wrapper from URL params', () => {
    const params = new URLSearchParams()
    params.set('settings', JSON.stringify({
      version: 1,
      settings: {
        customProviders: [{
          id: 'wrapped-custom',
          name: 'Wrapped Custom',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
          },
        }],
        profiles: [{
          id: 'wrapped-profile',
          name: 'Wrapped Profile',
          provider: 'wrapped-custom',
          baseUrl: 'https://wrapped.example.com/v1',
          apiKey: 'wrapped-key',
          model: 'wrapped-model',
          timeout: 300,
          apiMode: 'images',
          codexCli: false,
          apiProxy: false,
        }],
      },
    }))

    const next = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...buildSettingsFromUrlParams(DEFAULT_SETTINGS, params),
    })

    expect(next.customProviders).toHaveLength(1)
    expect(next.customProviders[0]).toMatchObject({ id: 'wrapped-custom', name: 'Wrapped Custom' })
    expect(next.profiles).toHaveLength(1)
    expect(next.profiles[0]).toMatchObject({
      id: 'wrapped-profile',
      provider: 'wrapped-custom',
      baseUrl: 'https://wrapped.example.com/v1',
      apiKey: 'wrapped-key',
      model: 'wrapped-model',
    })
  })

  it('patches the active profile instead of creating a new one when only default config is shown', async () => {
    const { buildSettingsFromUrlParams } = await importDefaultConfigOnlyUrlSettings()
    const current = normalizeSettings(DEFAULT_SETTINGS)
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, new URLSearchParams('apiUrl=https://api.example.com/v1&apiKey=test-key&model=custom-model&profileName=导入配置&apiMode=responses')),
    })

    expect(next.profiles).toHaveLength(1)
    expect(next.customProviders).toHaveLength(0)
    expect(next.activeProfileId).toBe(current.activeProfileId)
    expect(next.profiles[0]).toMatchObject({
      id: current.activeProfileId,
      provider: 'openai',
      name: '导入配置',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'custom-model',
      apiMode: 'responses',
    })
  })

  it('ignores imported custom providers and non-default provider profiles when only default config is shown', async () => {
    const { buildSettingsFromUrlParams } = await importDefaultConfigOnlyUrlSettings()
    const importedSettings = {
      customProviders: [{
        id: 'custom-json',
        name: 'Custom JSON',
        submit: {
          path: 'images/generations',
          method: 'POST',
          contentType: 'json',
          body: { model: '$profile.model', prompt: '$prompt' },
          result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
        },
      }],
      profiles: [{
        id: 'custom-profile',
        name: 'Custom Profile',
        provider: 'custom-json',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: 'custom-key',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
    }
    const params = new URLSearchParams()
    params.set('settings', JSON.stringify(importedSettings))

    const current = normalizeSettings(DEFAULT_SETTINGS)
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, params),
    })

    expect(next.profiles).toHaveLength(1)
    expect(next.customProviders).toHaveLength(0)
    expect(next.activeProfileId).toBe(current.activeProfileId)
    expect(next.profiles[0]).toMatchObject({
      provider: 'openai',
      baseUrl: current.profiles[0].baseUrl,
      apiKey: current.profiles[0].apiKey,
      model: current.profiles[0].model,
    })
  })

  it('patches from a matching imported profile without importing custom providers when only default config is shown', async () => {
    const { buildSettingsFromUrlParams } = await importDefaultConfigOnlyUrlSettings()
    const importedSettings = {
      customProviders: [{
        id: 'custom-json',
        name: 'Custom JSON',
        submit: {
          path: 'images/generations',
          method: 'POST',
          contentType: 'json',
          body: { model: '$profile.model', prompt: '$prompt' },
          result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
        },
      }],
      profiles: [{
        id: 'custom-profile',
        name: 'Custom Profile',
        provider: 'custom-json',
        baseUrl: 'https://custom.example.com/v1',
        apiKey: 'custom-key',
        model: 'custom-model',
        timeout: 300,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }, {
        id: 'openai-profile',
        name: 'OpenAI Profile',
        provider: 'openai',
        baseUrl: 'https://openai.example.com/v1',
        apiKey: 'openai-key',
        model: 'openai-model',
        timeout: 120,
        apiMode: 'responses',
        codexCli: true,
        apiProxy: true,
      }],
    }
    const params = new URLSearchParams()
    params.set('settings', JSON.stringify(importedSettings))

    const current = normalizeSettings(DEFAULT_SETTINGS)
    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, params),
    })

    expect(next.profiles).toHaveLength(1)
    expect(next.customProviders).toHaveLength(0)
    expect(next.activeProfileId).toBe(current.activeProfileId)
    expect(next.profiles[0]).toMatchObject({
      id: current.activeProfileId,
      provider: 'openai',
      name: 'OpenAI Profile',
      baseUrl: 'https://openai.example.com/v1',
      apiKey: 'openai-key',
      model: 'openai-model',
      timeout: 120,
      apiMode: 'responses',
      codexCli: true,
      apiProxy: true,
    })
  })

  it('does not switch away from the default custom provider when only default config is shown', async () => {
    const { buildSettingsFromUrlParams } = await importDefaultConfigOnlyUrlSettings()
    const customProvider = {
      id: 'custom-default',
      name: 'Custom Default',
      submit: {
        path: 'images/generations',
        method: 'POST' as const,
        contentType: 'json' as const,
        body: { model: '$profile.model', prompt: '$prompt' },
        result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
      },
    }
    const current = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customProviders: [customProvider],
      profiles: [{
        ...createDefaultOpenAIProfile({ id: 'custom-default-profile' }),
        name: 'Custom Default Profile',
        provider: customProvider.id,
        baseUrl: 'https://custom-default.example.com/v1',
        apiKey: 'custom-default-key',
        model: 'custom-default-model',
      }],
      activeProfileId: 'custom-default-profile',
    })
    const params = new URLSearchParams()
    params.set('settings', JSON.stringify({
      customProviders: [{
        id: 'another-custom',
        name: 'Another Custom',
        submit: customProvider.submit,
      }],
      profiles: [{
        id: 'openai-profile',
        name: 'Ignored OpenAI',
        provider: 'openai',
        baseUrl: 'https://openai.example.com/v1',
        apiKey: 'openai-key',
        model: 'openai-model',
        timeout: 120,
        apiMode: 'responses',
        codexCli: true,
        apiProxy: true,
      }, {
        id: 'matching-custom-profile',
        name: 'Patched Custom Default',
        provider: customProvider.id,
        baseUrl: 'https://patched-custom.example.com/v1',
        apiKey: 'patched-custom-key',
        model: 'patched-custom-model',
        timeout: 240,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }],
    }))

    const next = normalizeSettings({
      ...current,
      ...buildSettingsFromUrlParams(current, params),
    })

    expect(next.customProviders).toHaveLength(1)
    expect(next.customProviders[0].id).toBe(customProvider.id)
    expect(next.profiles).toHaveLength(1)
    expect(next.activeProfileId).toBe(current.activeProfileId)
    expect(next.profiles[0]).toMatchObject({
      id: current.activeProfileId,
      provider: customProvider.id,
      name: 'Patched Custom Default',
      baseUrl: 'https://patched-custom.example.com/v1',
      apiKey: 'patched-custom-key',
      model: 'patched-custom-model',
      timeout: 240,
      apiMode: 'images',
    })
  })
})

describe('station share', () => {
  const usedCustomProvider = {
    id: 'custom-used',
    name: 'Used Custom',
    submit: {
      path: 'images/generations',
      method: 'POST' as const,
      contentType: 'json' as const,
      body: { model: '$profile.model', prompt: '$prompt' },
      result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
    },
  }
  const unusedCustomProvider = {
    id: 'custom-unused',
    name: 'Unused Custom',
    submit: {
      path: 'images/generations',
      method: 'POST' as const,
      contentType: 'json' as const,
      body: { model: '$profile.model', prompt: '$prompt' },
      result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: [] },
    },
  }

  function createSharedStationsSettings() {
    const openaiProfile = createDefaultOpenAIProfile({
      id: 'share-openai',
      name: 'OpenAI 中转',
      baseUrl: 'https://openai-share.example.com/v1',
      apiKey: 'openai-share-key',
      model: 'gpt-image-share',
      providerDrafts: { openai: { model: 'draft-only' } },
    })
    const falProfile = createDefaultFalProfile({
      id: 'share-fal',
      name: 'fal 中转',
      apiKey: 'fal-share-key',
    })
    const customProfile = createDefaultOpenAIProfile({
      id: 'share-custom',
      name: '自定义中转',
      provider: usedCustomProvider.id,
      baseUrl: 'https://custom-share.example.com/v1',
      apiKey: 'custom-share-key',
      model: 'custom-share-model',
    })
    return normalizeSettings({
      ...DEFAULT_SETTINGS,
      customProviders: [usedCustomProvider, unusedCustomProvider],
      profiles: [openaiProfile, falProfile, customProfile],
      activeProfileId: falProfile.id,
    })
  }

  it('packs every station with API keys and only the custom providers in use', () => {
    const settings = createSharedStationsSettings()
    const payload = createStationSharePayload(settings)

    expect(payload.profiles.map((profile) => profile.id)).toEqual(['share-fal', 'share-openai', 'share-custom'])
    expect(payload.profiles.map((profile) => profile.apiKey)).toEqual(['fal-share-key', 'openai-share-key', 'custom-share-key'])
    expect(payload.customProviders.map((provider) => provider.id)).toEqual([usedCustomProvider.id])
    expect(payload.profiles.some((profile) => 'providerDrafts' in profile && profile.providerDrafts)).toBe(false)
  })

  it('imports a generated share URL into a fresh workspace and activates the original current station', () => {
    const settings = createSharedStationsSettings()
    const payload = createStationSharePayload(settings)
    const shareUrl = createStationShareUrl('https://app.example.com/tools?foo=1#hash', payload)
    const imported = parseStationShareText(shareUrl)
    const next = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...buildSettingsFromUrlParams(DEFAULT_SETTINGS, new URL(shareUrl).searchParams),
    })
    const activeProfile = next.profiles.find((profile) => profile.id === next.activeProfileId)

    expect(shareUrl).not.toContain('foo=1')
    expect(shareUrl).not.toContain('#hash')
    expect(imported.profiles).toHaveLength(3)
    expect(next.profiles).toHaveLength(3)
    expect(next.customProviders).toHaveLength(1)
    expect(activeProfile).toMatchObject({
      name: 'fal 中转',
      provider: 'fal',
      apiKey: 'fal-share-key',
    })
  })

  it('parses a full URL, a query string, raw JSON, and a settings wrapper', () => {
    const settings = createSharedStationsSettings()
    const payload = createStationSharePayload(settings)
    const shareUrl = createStationShareUrl('https://app.example.com/', payload)

    expect(parseStationShareText(`  ${shareUrl}  `).profiles).toHaveLength(3)
    expect(parseStationShareText(new URL(shareUrl).search).profiles[0]).toMatchObject({ id: 'share-fal' })
    expect(parseStationShareText(JSON.stringify(payload)).customProviders).toHaveLength(1)
    expect(parseStationShareText(JSON.stringify({ version: 1, settings: payload })).profiles.map((profile) => profile.apiKey)).toContain('openai-share-key')
    expect(() => parseStationShareText('')).toThrow('请粘贴导入 URL 或 JSON')
    expect(() => parseStationShareText('not-a-share')).toThrow('无法识别分享内容，请粘贴导入 URL 或 JSON')
  })

  it('does not duplicate stations when the same share is imported again', () => {
    const settings = createSharedStationsSettings()
    const payload = createStationSharePayload(settings)
    const firstImport = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...buildSettingsFromUrlParams(DEFAULT_SETTINGS, new URLSearchParams({ settings: JSON.stringify(payload) })),
    })
    const secondImport = normalizeSettings({
      ...firstImport,
      ...buildSettingsFromUrlParams(firstImport, new URLSearchParams({ settings: JSON.stringify(payload) })),
    })

    expect(firstImport.profiles).toHaveLength(3)
    expect(secondImport.profiles).toHaveLength(3)
    expect(countNewStationProfilesAfterImport(firstImport, payload)).toBe(0)
  })

  it('falls back to JSON when the share URL would be truncated', () => {
    const bulkySettings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: Array.from({ length: 12 }, (_, index) => createDefaultOpenAIProfile({
        id: `bulky-${index}`,
        name: `很长的中转站名称用来撑开分享链接-${index}`,
        baseUrl: `https://relay-${index}.example.com/v1`,
        apiKey: `very-long-api-key-${index}-${'x'.repeat(40)}`,
        model: `very-long-model-id-${index}`,
      })),
      activeProfileId: 'bulky-0',
    })
    const payload = createStationSharePayload(bulkySettings)
    const shared = createStationShareClipboardText('https://app.example.com/', payload)

    expect(createStationShareUrl('https://app.example.com/', payload).length).toBeGreaterThan(STATION_SHARE_URL_MAX_LENGTH)
    expect(shared.format).toBe('json')
    expect(parseStationShareText(shared.text).profiles).toHaveLength(12)
  })

  it('wires share-all and paste-import onto the existing merge path', () => {
    expect(settingsModalSource).toContain('createStationSharePayload')
    expect(settingsModalSource).toContain('createStationShareClipboardText')
    expect(settingsModalSource).toContain('parseStationShareText')
    expect(settingsModalSource).toContain('mergeImportedSettings')
    expect(settingsModalSource).toContain('activateFirstImportedProfile')
    expect(settingsModalSource).toContain('分享全部')
    expect(settingsModalSource).toContain('粘贴导入')
    expect(settingsModalSource).toContain('已复制')
    expect(settingsModalSource).toContain('含 API Key')
  })
})
