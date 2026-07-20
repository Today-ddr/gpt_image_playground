import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { fetchApiModels } from './apiModels'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchApiModels', () => {
  it('requires an API key before requesting models', async () => {
    await expect(fetchApiModels(createDefaultOpenAIProfile({ apiKey: '' }))).rejects.toThrow('请先填写 API Key')
  })

  it('requires an API URL when the proxy is unavailable', async () => {
    await expect(fetchApiModels(createDefaultOpenAIProfile({ baseUrl: '', apiKey: 'test-key' }))).rejects.toThrow('请先填写 API URL')
  })

  it('filters, trims, deduplicates, and sorts standard model data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: ' z-model ' }, null, { id: '' }, { id: 3 }, { id: 'a-model' }, { id: 'z-model' }],
    }), { status: 200 })))

    await expect(fetchApiModels(createDefaultOpenAIProfile({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
    }))).resolves.toEqual(['a-model', 'z-model'])
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/v1/models', expect.objectContaining({
      headers: { Authorization: 'Bearer test-key' },
    }))
  })

  it.each([
    {},
    { data: {} },
  ])('rejects invalid top-level model data %#', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })))

    await expect(fetchApiModels(createDefaultOpenAIProfile({ apiKey: 'test-key' }))).rejects.toThrow('模型列表响应格式无效')
  })

  it('uses the configured proxy URL', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 })))

    await fetchApiModels(createDefaultOpenAIProfile({ apiKey: 'test-key', apiProxy: true }))

    expect(fetch).toHaveBeenCalledWith('/api-proxy/models', expect.anything())
  })

  it('does not expose an API key from an HTTP error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream leaked secret-key', { status: 401 })))

    const promise = fetchApiModels(createDefaultOpenAIProfile({ apiKey: 'secret-key' }))
    await expect(promise).rejects.toThrow('获取模型列表失败：HTTP 401')
    await expect(promise).rejects.not.toThrow('secret-key')
  })

  it('maps network errors to a fixed message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('secret-key failed')))

    await expect(fetchApiModels(createDefaultOpenAIProfile({ apiKey: 'secret-key' }))).rejects.toThrow('获取模型列表失败，请检查网络、API URL 或跨域设置')
  })

  it('maps request timeouts to a fixed message', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))

    const promise = fetchApiModels(createDefaultOpenAIProfile({ apiKey: 'test-key', timeout: 1 }))
    const expectation = expect(promise).rejects.toThrow('获取模型列表超时')
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
    vi.useRealTimers()
  })
})
