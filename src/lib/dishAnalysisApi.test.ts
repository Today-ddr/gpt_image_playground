import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultFalProfile, createDefaultOpenAIProfile } from './apiProfiles'
import { analyzeDish } from './dishAnalysisApi'

const request = {
  profile: createDefaultOpenAIProfile({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'image-model',
    understandingModel: 'vision-model',
  }),
  imageDataUrl: 'data:image/png;base64,AQID',
  userPrompt: '分析这份午餐',
  systemPrompt: '你是餐品分析助手',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('analyzeDish', () => {
  it('sends a multimodal Chat Completions request with the understanding model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '一份午餐' } }],
    }), { status: 200 })))

    await expect(analyzeDish(request)).resolves.toBe('一份午餐')
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    }))

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'vision-model',
      messages: [
        { role: 'system', content: '你是餐品分析助手' },
        {
          role: 'user',
          content: [
            { type: 'text', text: '分析这份午餐' },
            { type: 'image_url', image_url: { url: request.imageDataUrl } },
          ],
        },
      ],
    })
  })

  it('joins text parts from array content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: 'text', text: '第一段' }, { type: 'other' }, { type: 'text', text: '第二段' }] } }],
    }), { status: 200 })))

    await expect(analyzeDish(request)).resolves.toBe('第一段\n第二段')
  })

  it('allows text-only analysis without sending an image part', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '文字分析结果' } }],
    }), { status: 200 })))

    await expect(analyzeDish({ ...request, imageDataUrl: '' })).resolves.toBe('文字分析结果')
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body)).messages[1].content).toEqual([
      { type: 'text', text: '分析这份午餐' },
    ])
  })

  it.each([
    [createDefaultFalProfile({ apiKey: 'fal-key' }), '当前 API 配置不支持餐品解析'],
    [createDefaultOpenAIProfile({ apiKey: 'test-key', understandingModel: '' }), '请先配置语义理解/多模态模型 ID'],
    [createDefaultOpenAIProfile({ baseUrl: '', apiKey: 'test-key', understandingModel: 'vision-model' }), '请先填写 API URL'],
    [createDefaultOpenAIProfile({ apiKey: '', understandingModel: 'vision-model' }), '请先填写 API Key'],
  ])('rejects invalid profiles before sending a request %#', async (profile, message) => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(analyzeDish({ ...request, profile })).rejects.toThrow(message)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['userPrompt', ' ', '请输入用户内容'],
    ['systemPrompt', '', '请输入系统提示词'],
  ] as const)('validates %s before sending a request', async (key, value, message) => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(analyzeDish({ ...request, [key]: value })).rejects.toThrow(message)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the configured API proxy', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '完成' } }],
    }), { status: 200 })))

    await analyzeDish({ ...request, profile: { ...request.profile, baseUrl: '', apiProxy: true } })
    expect(fetch).toHaveBeenCalledWith('/api-proxy/chat/completions', expect.anything())
  })

  it('does not expose the API key or upstream body in HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('leaked test-key', { status: 401 })))
    const promise = analyzeDish(request)
    await expect(promise).rejects.toThrow('餐品解析失败：HTTP 401')
    await expect(promise).rejects.not.toThrow('test-key')
  })

  it('rejects invalid JSON and responses without text', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 })))

    await expect(analyzeDish(request)).rejects.toThrow('餐品解析响应格式无效')
    await expect(analyzeDish(request)).rejects.toThrow('餐品解析结果为空')
  })

  it('maps network errors to a fixed message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('test-key leaked')))
    await expect(analyzeDish(request)).rejects.toThrow('餐品解析失败，请检查网络、API URL 或跨域设置')
  })

  it('distinguishes user cancellation from timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))

    const userController = new AbortController()
    const cancelled = analyzeDish({ ...request, signal: userController.signal })
    const cancelledExpectation = expect(cancelled).rejects.toThrow('餐品解析已取消')
    userController.abort()
    await cancelledExpectation

    const timedOut = analyzeDish({ ...request, profile: { ...request.profile, timeout: 1 } })
    const timeoutExpectation = expect(timedOut).rejects.toThrow('餐品解析超时')
    await vi.advanceTimersByTimeAsync(1000)
    await timeoutExpectation
  })
})
