import type { ApiMode, ApiProfile, AppMode, AppSettings, CustomProviderDefinition } from '../types'
import { normalizeBaseUrl } from './devProxy'
import {
  createDefaultOpenAIProfile,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_RESPONSES_MODEL,
  findEquivalentApiProfile,
  isDefaultConfigOnlyEnabled,
  mergeImportedSettings,
  normalizeSettings,
  normalizeStreamPartialImages,
} from './apiProfiles'

const URL_SETTING_KEYS = ['settings', 'apiUrl', 'apiKey', 'codexCli', 'apiMode', 'model', 'understandingModel', 'profileName', 'streamImages', 'streamPartialImages']
const APP_MODE_URL_KEY = 'appMode'
export const STATION_SHARE_URL_MAX_LENGTH = 2000

export type StationSharePayload = {
  customProviders: CustomProviderDefinition[]
  profiles: ApiProfile[]
}

export type StationShareClipboardText = {
  text: string
  format: 'url' | 'json'
}

export function getAppModeFromUrlParams(searchParams: URLSearchParams): AppMode | null {
  return searchParams.get(APP_MODE_URL_KEY) === 'tools' ? 'tools' : null
}

export function setAppModeUrlParams(searchParams: URLSearchParams, appMode: AppMode) {
  if (appMode === 'tools') {
    searchParams.set(APP_MODE_URL_KEY, 'tools')
    return
  }

  searchParams.delete(APP_MODE_URL_KEY)
}

function getProfileDedupKey(profile: Pick<AppSettings['profiles'][number], 'provider' | 'baseUrl' | 'apiKey' | 'model' | 'understandingModel' | 'apiMode' | 'codexCli' | 'streamImages' | 'streamPartialImages'>) {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.apiKey.trim(),
    profile.model.trim(),
    profile.understandingModel?.trim() ?? '',
    profile.apiMode,
    profile.codexCli === true,
    profile.streamImages === true,
    profile.streamPartialImages ?? 0,
  ])
}

export function setOpenAIProfileImportUrlParams(searchParams: URLSearchParams, profile: Pick<ApiProfile, 'apiMode' | 'model' | 'understandingModel'>) {
  searchParams.set('apiMode', profile.apiMode)
  searchParams.set('model', profile.model.trim())
  if (profile.understandingModel?.trim()) searchParams.set('understandingModel', profile.understandingModel.trim())
  else searchParams.delete('understandingModel')
}

function createUrlProfileId(usedIds: Set<string>) {
  let id = `openai-url-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `openai-url-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  return id
}

function pickUrlSettingsPayload(value: unknown): unknown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return {
    customProviders: record.customProviders,
    profiles: record.profiles,
  }
}

function getUrlSettingsPayload(searchParams: URLSearchParams): unknown | null {
  const raw = searchParams.get('settings')
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'settings' in parsed) {
      return pickUrlSettingsPayload((parsed as { settings?: unknown }).settings ?? null)
    }
    return pickUrlSettingsPayload(parsed)
  } catch {
    return null
  }
}

function cloneShareableProfile(profile: ApiProfile): ApiProfile {
  const { providerDrafts: _providerDrafts, ...shareableProfile } = profile
  return shareableProfile
}

function extractStationSharePayload(value: unknown): StationSharePayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const nested = record.settings
  const source = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : record
  if (!Array.isArray(source.profiles) || source.profiles.length === 0) return null
  return {
    customProviders: Array.isArray(source.customProviders) ? source.customProviders as CustomProviderDefinition[] : [],
    profiles: source.profiles as ApiProfile[],
  }
}

function parseStationShareJson(text: string): StationSharePayload | null {
  try {
    return extractStationSharePayload(JSON.parse(text))
  } catch {
    return null
  }
}

function parseStationShareSearch(search: string): StationSharePayload | null {
  const query = search.startsWith('?') ? search.slice(1) : search
  const raw = new URLSearchParams(query).get('settings')
  if (!raw) return null
  return parseStationShareJson(raw)
}

export function createStationSharePayload(settings: Partial<AppSettings> | unknown): StationSharePayload {
  const normalized = normalizeSettings(settings)
  const activeProfile = normalized.profiles.find((profile) => profile.id === normalized.activeProfileId) ?? normalized.profiles[0]
  const remainingProfiles = activeProfile
    ? normalized.profiles.filter((profile) => profile.id !== activeProfile.id)
    : normalized.profiles
  const profiles = (activeProfile ? [activeProfile, ...remainingProfiles] : remainingProfiles).map(cloneShareableProfile)
  const usedProviderIds = new Set(profiles.map((profile) => profile.provider))
  return {
    customProviders: normalized.customProviders.filter((provider) => usedProviderIds.has(provider.id)),
    profiles,
  }
}

export function createStationShareUrl(originHref: string, payload: StationSharePayload): string {
  const url = new URL(originHref)
  url.search = ''
  url.hash = ''
  url.searchParams.set('settings', JSON.stringify(payload))
  return url.toString()
}

export function createStationShareClipboardText(originHref: string, payload: StationSharePayload): StationShareClipboardText {
  const url = createStationShareUrl(originHref, payload)
  if (url.length <= STATION_SHARE_URL_MAX_LENGTH) return { text: url, format: 'url' }
  return { text: JSON.stringify(payload), format: 'json' }
}

export function parseStationShareText(text: string): StationSharePayload {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('请粘贴导入 URL 或 JSON')

  try {
    const fromAbsoluteUrl = parseStationShareSearch(new URL(trimmed).search)
    if (fromAbsoluteUrl) return fromAbsoluteUrl
  } catch {
    // 不是完整 URL，继续尝试 query / JSON
  }

  const queryStart = trimmed.indexOf('?')
  if (queryStart >= 0) {
    const fromQuery = parseStationShareSearch(trimmed.slice(queryStart))
    if (fromQuery) return fromQuery
  } else if (trimmed.includes('settings=')) {
    const fromBareQuery = parseStationShareSearch(trimmed)
    if (fromBareQuery) return fromBareQuery
  }

  const fromJson = parseStationShareJson(trimmed)
  if (fromJson) return fromJson

  throw new Error('无法识别分享内容，请粘贴导入 URL 或 JSON')
}

export function countNewStationProfilesAfterImport(
  currentSettings: Partial<AppSettings> | unknown,
  importedSettings: StationSharePayload,
): number {
  const current = normalizeSettings(currentSettings)
  const next = mergeImportedSettings(current, importedSettings)
  const currentKeys = new Set(current.profiles.map((profile) => getProfileDedupKey(profile)))
  return next.profiles.filter((profile) => !currentKeys.has(getProfileDedupKey(profile))).length
}

export function activateFirstImportedProfile(settings: AppSettings, importedSettings: unknown): AppSettings {
  if (!importedSettings || typeof importedSettings !== 'object' || Array.isArray(importedSettings)) return settings

  const record = importedSettings as Record<string, unknown>
  if (!Array.isArray(record.profiles) || record.profiles.length === 0) return settings

  const imported = normalizeSettings({
    customProviders: record.customProviders,
    profiles: record.profiles,
  })
  const importedProfile = imported.profiles[0]
  const activeProfile = findEquivalentApiProfile(settings, importedProfile, imported.customProviders)

  return activeProfile
    ? normalizeSettings({ ...settings, activeProfileId: activeProfile.id })
    : settings
}

/**
 * 仅展示默认配置模式：从 URL 参数中提取可覆盖的字段，patch 到当前活跃配置上。
 * 不新建配置、不导入自定义服务商、不切换 provider。
 */
function buildDefaultConfigOnlySettingsFromUrlParams(currentSettings: Partial<AppSettings> | unknown, searchParams: URLSearchParams): Partial<AppSettings> {
  const settings = normalizeSettings(currentSettings)
  const activeProfile = settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0]
  if (!activeProfile) return {}

  const isOpenAI = activeProfile.provider === 'openai'
  const patch: Partial<typeof activeProfile> = {}

  // 从 ?settings= JSON 中提取同 provider 的 profile 字段
  const importedSettings = getUrlSettingsPayload(searchParams)
  if (importedSettings && typeof importedSettings === 'object' && !Array.isArray(importedSettings)) {
    const profiles = (importedSettings as Record<string, unknown>).profiles
    if (Array.isArray(profiles)) {
      const matched = profiles.find((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false
        const p = (item as Record<string, unknown>).provider
        return p === undefined || p === activeProfile.provider
      }) as Record<string, unknown> | undefined
      if (matched) {
        if (typeof matched.name === 'string' && matched.name.trim()) patch.name = matched.name.trim()
        if (typeof matched.baseUrl === 'string') patch.baseUrl = matched.baseUrl
        if (typeof matched.apiKey === 'string') patch.apiKey = matched.apiKey
        if (typeof matched.model === 'string' && matched.model.trim()) patch.model = matched.model.trim()
        if (typeof matched.understandingModel === 'string') patch.understandingModel = matched.understandingModel.trim()
        if (typeof matched.timeout === 'number' && Number.isFinite(matched.timeout)) patch.timeout = matched.timeout
        if (typeof matched.apiProxy === 'boolean') patch.apiProxy = matched.apiProxy
        if (matched.responseFormatB64Json === true) patch.responseFormatB64Json = true
        if (isOpenAI) {
          if (matched.apiMode === 'images' || matched.apiMode === 'responses') patch.apiMode = matched.apiMode
          if (typeof matched.codexCli === 'boolean') patch.codexCli = matched.codexCli
          if (typeof matched.streamImages === 'boolean') patch.streamImages = matched.streamImages
          if (matched.streamPartialImages !== undefined) patch.streamPartialImages = normalizeStreamPartialImages(matched.streamPartialImages)
        }
      }
    }
  }

  // 查询参数覆盖（优先级高于 settings JSON）
  const apiUrlParam = searchParams.get('apiUrl')
  const apiKeyParam = searchParams.get('apiKey')
  const modelParam = searchParams.get('model')
  const understandingModelParam = searchParams.get('understandingModel')
  const profileNameParam = searchParams.get('profileName')
  if (profileNameParam?.trim()) patch.name = profileNameParam.trim()
  if (apiUrlParam !== null) patch.baseUrl = normalizeBaseUrl(apiUrlParam.trim())
  if (apiKeyParam !== null) patch.apiKey = apiKeyParam.trim()
  if (modelParam !== null && modelParam.trim()) patch.model = modelParam.trim()
  if (understandingModelParam !== null) patch.understandingModel = understandingModelParam.trim()
  if (isOpenAI) {
    const apiModeParam = searchParams.get('apiMode')
    const codexCliParam = searchParams.get('codexCli')
    const streamImagesParam = searchParams.get('streamImages')
    const streamPartialImagesParam = searchParams.get('streamPartialImages')
    if (apiModeParam === 'images' || apiModeParam === 'responses') patch.apiMode = apiModeParam
    if (codexCliParam !== null) patch.codexCli = codexCliParam.trim().toLowerCase() === 'true'
    if (streamImagesParam !== null) patch.streamImages = streamImagesParam.trim().toLowerCase() === 'true'
    if (streamPartialImagesParam !== null) patch.streamPartialImages = normalizeStreamPartialImages(streamPartialImagesParam)
  }

  if (Object.keys(patch).length === 0) return {}

  return normalizeSettings({
    ...settings,
    profiles: settings.profiles.map((profile) =>
      profile.id === activeProfile.id ? { ...profile, ...patch, provider: profile.provider } : profile,
    ),
  })
}

export function hasUrlSettingParams(searchParams: URLSearchParams) {
  return URL_SETTING_KEYS.some((key) => searchParams.has(key))
}

export function clearUrlSettingParams(searchParams: URLSearchParams) {
  for (const key of URL_SETTING_KEYS) searchParams.delete(key)
}

export function buildSettingsFromUrlParams(currentSettings: Partial<AppSettings> | unknown, searchParams: URLSearchParams): Partial<AppSettings> {
  if (isDefaultConfigOnlyEnabled()) return buildDefaultConfigOnlySettingsFromUrlParams(currentSettings, searchParams)

  const importedSettings = getUrlSettingsPayload(searchParams)
  const apiUrlParam = searchParams.get('apiUrl')
  const apiKeyParam = searchParams.get('apiKey')
  const codexCliParam = searchParams.get('codexCli')
  const apiModeParam = searchParams.get('apiMode')
  const modelParam = searchParams.get('model')
  const understandingModelParam = searchParams.get('understandingModel')
  const profileNameParam = searchParams.get('profileName')
  const profileName = profileNameParam?.trim() ?? ''
  const streamImagesParam = searchParams.get('streamImages')
  const streamPartialImagesParam = searchParams.get('streamPartialImages')
  const apiMode: ApiMode | undefined = apiModeParam === 'images' || apiModeParam === 'responses' ? apiModeParam : undefined

  const hasLegacyOpenAIParams = apiUrlParam !== null || apiKeyParam !== null || codexCliParam !== null || apiMode !== undefined || modelParam !== null || understandingModelParam !== null || profileNameParam !== null || streamImagesParam !== null || streamPartialImagesParam !== null
  const settings = importedSettings == null
    ? normalizeSettings(currentSettings)
    : activateFirstImportedProfile(mergeImportedSettings(currentSettings, importedSettings), importedSettings)

  if (hasLegacyOpenAIParams) {
    const profileApiMode = apiMode ?? 'images'
    const profile = createDefaultOpenAIProfile({
      id: createUrlProfileId(new Set(settings.profiles.map((item) => item.id))),
      name: 'URL 参数配置',
      apiMode: profileApiMode,
      model: profileApiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL,
    })
    if (apiUrlParam !== null) profile.baseUrl = normalizeBaseUrl(apiUrlParam.trim())
    if (apiKeyParam !== null) profile.apiKey = apiKeyParam.trim()
    if (modelParam !== null && modelParam.trim()) profile.model = modelParam.trim()
    if (understandingModelParam !== null) profile.understandingModel = understandingModelParam.trim()
    if (profileName) profile.name = profileName
    if (codexCliParam !== null) profile.codexCli = codexCliParam.trim().toLowerCase() === 'true'
    if (streamImagesParam !== null) profile.streamImages = streamImagesParam.trim().toLowerCase() === 'true'
    if (streamPartialImagesParam !== null) profile.streamPartialImages = normalizeStreamPartialImages(streamPartialImagesParam)

    const existingProfile = settings.profiles.find((item) =>
      getProfileDedupKey(item) === getProfileDedupKey(profile) &&
      (!profileName || item.name.trim() === profileName)
    )
    if (existingProfile) {
      return normalizeSettings({ ...settings, activeProfileId: existingProfile.id })
    }

    return normalizeSettings({
      ...settings,
      profiles: [...settings.profiles, profile],
      activeProfileId: profile.id,
    })
  }

  return importedSettings == null ? {} : settings
}
