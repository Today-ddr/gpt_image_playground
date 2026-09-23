import type { ApiProfile, AppSettings } from '../types'
import { getCustomProviderDefinition } from './apiProfiles'
import { customProviderSupportsNativeTransparentBackground } from './customProviderCapabilities'

/** 缺省和无法走原生透明的自定义服务商都按本地抠图，避免旧配置突然改出图方式。 */
export function effectiveTransparentBackgroundMethod(
  profile: ApiProfile,
  settings?: Partial<AppSettings> | unknown,
): 'api' | 'local' {
  if (profile.transparentBackgroundMethod !== 'api') return 'local'
  if (profile.provider === 'openai' || profile.provider === 'fal') return 'api'
  const custom = getCustomProviderDefinition(settings, profile.provider)
  if (!custom || !customProviderSupportsNativeTransparentBackground(custom)) return 'local'
  return 'api'
}
