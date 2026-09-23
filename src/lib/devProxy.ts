import { readRuntimeEnv } from './runtimeEnv'

export interface DevProxyConfig {
  enabled: boolean
  prefix: string
  target: string
  changeOrigin: boolean
  secure: boolean
}

const DEFAULT_PROXY_PREFIX = '/api-proxy'
export const API_PROXY_TARGET_HEADER = 'X-Api-Proxy-Target'

function hostDefaultsToHttp(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (
    normalizedHostname === 'localhost'
    || normalizedHostname === '::1'
    || normalizedHostname === '0.0.0.0'
    || normalizedHostname.endsWith('.localhost')
  ) {
    return true
  }

  const ipv4Match = normalizedHostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4Match) return false

  const octets = ipv4Match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return false

  const [firstOctet, secondOctet] = octets
  return firstOctet === 10
    || firstOctet === 127
    || firstOctet === 0
    || (firstOctet === 192 && secondOctet === 168)
    || (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31)
    || (firstOctet === 169 && secondOctet === 254)
}

function withInferredProtocol(input: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(input)) return input

  const hostname = input.split('/')[0]?.split(':')[0] ?? input
  const protocol = hostDefaultsToHttp(hostname) ? 'http' : 'https'
  return `${protocol}://${input}`
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''

  const input = withInferredProtocol(trimmed)

  try {
    const url = new URL(input)
    if (trimmed.endsWith('/')) return `${url.origin}${url.pathname.replace(/\/+$/, '/')}`

    const pathSegments = url.pathname.split('/').filter(Boolean)
    const v1Index = pathSegments.indexOf('v1')
    const normalizedSegments = v1Index >= 0
      ? pathSegments.slice(0, v1Index + 1)
      : pathSegments.length
        ? [...pathSegments, 'v1']
        : []
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function normalizeDevProxyConfig(input: unknown): DevProxyConfig | null {
  if (!input || typeof input !== 'object') return null

  const record = input as Record<string, unknown>
  const target = normalizeBaseUrl(typeof record.target === 'string' ? record.target : '')
  if (!target) return null

  const rawPrefix = typeof record.prefix === 'string' ? record.prefix : DEFAULT_PROXY_PREFIX
  const trimmedPrefix = rawPrefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const prefix = trimmedPrefix ? `/${trimmedPrefix}` : DEFAULT_PROXY_PREFIX

  return {
    enabled: Boolean(record.enabled),
    prefix,
    target,
    changeOrigin: record.changeOrigin !== false,
    secure: Boolean(record.secure),
  }
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  proxyConfig?: DevProxyConfig | null,
  useApiProxy = false,
): string {
  const trimmedBaseUrl = baseUrl.trim()
  const endpointPath = path.replace(/^\/+/, '')

  if (useApiProxy) {
    return `${proxyConfig?.prefix ?? DEFAULT_PROXY_PREFIX}/${endpointPath}`
  }

  const normalizedBaseUrl = normalizeBaseUrl(trimmedBaseUrl)
  if (trimmedBaseUrl.endsWith('/')) {
    return `${normalizedBaseUrl.replace(/\/+$/, '')}/${endpointPath}`
  }

  const apiPath = normalizedBaseUrl.endsWith('/v1')
    ? endpointPath
    : ['v1', endpointPath].join('/')

  return normalizedBaseUrl ? `${normalizedBaseUrl}/${apiPath}` : `/${apiPath}`
}

export function resolveDevProxyConfig(input: unknown, isDev: boolean): DevProxyConfig | null {
  if (!isDev) return null
  return normalizeDevProxyConfig(input)
}

export function readClientDevProxyConfig(): DevProxyConfig | null {
  return resolveDevProxyConfig(
    typeof __DEV_PROXY_CONFIG__ === 'undefined' ? null : __DEV_PROXY_CONFIG__,
    import.meta.env.DEV,
  )
}

export function isApiProxyAvailable(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_AVAILABLE) === 'true' || Boolean(proxyConfig?.enabled)
}

export function isApiProxyLocked(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_LOCKED) === 'true' && isApiProxyAvailable(proxyConfig)
}

export function shouldUseApiProxy(apiProxy: boolean, proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return isApiProxyAvailable(proxyConfig) && (apiProxy || isApiProxyLocked(proxyConfig))
}

export function resolveApiProxyUpstream(headerValue: unknown, fallbackTarget = ''): string {
  const rawHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (typeof rawHeader === 'string') {
    const normalizedHeader = rawHeader.trim().replace(/\/+$/, '')
    if (/^https?:\/\//i.test(normalizedHeader)) return normalizedHeader
  }

  return fallbackTarget.trim().replace(/\/+$/, '')
}

export function resolveApiProxyTargetBase(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const normalizedBaseUrl = normalizeBaseUrl(trimmed)
  if (!normalizedBaseUrl) return ''
  if (trimmed.endsWith('/')) return normalizedBaseUrl.replace(/\/+$/, '')
  if (normalizedBaseUrl.endsWith('/v1')) return normalizedBaseUrl
  return `${normalizedBaseUrl}/v1`
}

export function withApiProxyHeaders(
  profile: { baseUrl: string; apiProxy: boolean },
  headers: Record<string, string> = {},
  proxyConfig: DevProxyConfig | null = readClientDevProxyConfig(),
): Record<string, string> {
  if (!shouldUseApiProxy(profile.apiProxy, proxyConfig) || isApiProxyLocked(proxyConfig)) {
    return { ...headers }
  }

  const target = resolveApiProxyTargetBase(profile.baseUrl)
  if (!target) return { ...headers }

  return {
    ...headers,
    [API_PROXY_TARGET_HEADER]: target,
  }
}
