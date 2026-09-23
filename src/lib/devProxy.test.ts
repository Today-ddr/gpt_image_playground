import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_PROXY_TARGET_HEADER, buildApiUrl, normalizeBaseUrl, resolveApiProxyTargetBase, resolveApiProxyUpstream, withApiProxyHeaders } from './devProxy'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildApiUrl', () => {
  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
  })

  it('leaves API versioning to the proxy target when proxying', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/images/generations',
    )
  })

  it('uses a configured proxy prefix when one is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/responses')
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })
})

describe('normalizeBaseUrl', () => {
  it('defaults public hosts without a scheme to https', () => {
    expect(normalizeBaseUrl('apiiiii.tooday.pw/')).toBe('https://apiiiii.tooday.pw')
  })

  it('defaults private LAN addresses without a scheme to http', () => {
    expect(normalizeBaseUrl('192.168.1.41:8090')).toBe('http://192.168.1.41:8090')
  })
})

describe('resolveApiProxyTargetBase', () => {
  it('adds /v1 when the settings URL is only an origin', () => {
    expect(resolveApiProxyTargetBase('https://apiiiii.tooday.pw/')).toBe('https://apiiiii.tooday.pw/v1')
  })

  it('keeps an explicit /v1 prefix', () => {
    expect(resolveApiProxyTargetBase('http://192.168.1.41:8090/v1')).toBe('http://192.168.1.41:8090/v1')
  })
})

describe('resolveApiProxyUpstream', () => {
  it('prefers a valid absolute http(s) header over the fallback target', () => {
    expect(resolveApiProxyUpstream('https://apiiiii.tooday.pw/v1/', 'https://api.openai.com/v1')).toBe(
      'https://apiiiii.tooday.pw/v1',
    )
  })

  it('ignores invalid headers and uses the fallback target', () => {
    expect(resolveApiProxyUpstream('javascript:alert(1)', 'https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1',
    )
  })
})

describe('withApiProxyHeaders', () => {
  it('sends the settings API URL to the same-origin proxy when it is not locked', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')

    expect(withApiProxyHeaders({
      baseUrl: 'https://apiiiii.tooday.pw/',
      apiProxy: true,
    }, { Authorization: 'Bearer test-key' })).toEqual({
      Authorization: 'Bearer test-key',
      [API_PROXY_TARGET_HEADER]: 'https://apiiiii.tooday.pw/v1',
    })
  })

  it('uses http for a private LAN address sent through the proxy', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')

    expect(withApiProxyHeaders({
      baseUrl: '192.168.1.41:8090',
      apiProxy: true,
    })).toEqual({
      [API_PROXY_TARGET_HEADER]: 'http://192.168.1.41:8090/v1',
    })
  })

  it('does not send a target header when the proxy is locked to the deploy-time URL', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')

    expect(withApiProxyHeaders({
      baseUrl: 'https://apiiiii.tooday.pw/',
      apiProxy: false,
    }, { Authorization: 'Bearer test-key' })).toEqual({
      Authorization: 'Bearer test-key',
    })
  })
})
