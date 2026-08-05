import type { ApiProfile } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'

type AnalyzeDishOptions = {
  profile: ApiProfile
  userPrompt: string
  systemPrompt: string
  signal?: AbortSignal
}

class DishAnalysisError extends Error {}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text.trim()
      : '')
    .filter(Boolean)
    .join('\n')
}

export async function analyzeDish(opts: AnalyzeDishOptions): Promise<string> {
  const profile = opts.profile
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)

  if (profile.provider !== 'openai') throw new Error('当前 API 配置不支持餐品解析')
  if (!profile.understandingModel?.trim()) throw new Error('请先配置语义理解/多模态模型 ID')
  if (!profile.baseUrl.trim() && !useApiProxy) throw new Error('请先填写 API URL')
  if (!profile.apiKey.trim()) throw new Error('请先填写 API Key')
  if (!opts.userPrompt.trim()) throw new Error('请输入用户内容')
  if (!opts.systemPrompt.trim()) throw new Error('请输入系统提示词')
  if (opts.signal?.aborted) throw new Error('餐品解析已取消')

  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, profile.timeout * 1000)
  const abortFromCaller = () => controller.abort()
  opts.signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const userContent: Array<Record<string, unknown>> = [
      { type: 'text', text: opts.userPrompt.trim() },
    ]

    const response = await fetch(buildApiUrl(profile.baseUrl, 'chat/completions', proxyConfig, useApiProxy), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: profile.understandingModel.trim(),
        // 订单解析需要低延迟；DeepSeek 等模型默认开启 thinking，显式关闭以加速
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: opts.systemPrompt.trim() },
          {
            role: 'user',
            content: userContent,
          },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new DishAnalysisError(`餐品解析失败：HTTP ${response.status}`)

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new DishAnalysisError('餐品解析响应格式无效')
    }

    if (!body || typeof body !== 'object') throw new DishAnalysisError('餐品解析响应格式无效')
    const choices = (body as { choices?: unknown }).choices
    if (!Array.isArray(choices)) throw new DishAnalysisError('餐品解析响应格式无效')
    const message = choices[0] && typeof choices[0] === 'object'
      ? (choices[0] as { message?: unknown }).message
      : null
    const content = message && typeof message === 'object'
      ? (message as { content?: unknown }).content
      : null
    const text = extractContentText(content)
    if (!text) throw new DishAnalysisError('餐品解析结果为空')
    return text
  } catch (err) {
    if (err instanceof DishAnalysisError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(timedOut ? '餐品解析超时' : '餐品解析已取消')
    }
    throw new Error('餐品解析失败，请检查网络、API URL 或跨域设置')
  } finally {
    clearTimeout(timeoutId)
    opts.signal?.removeEventListener('abort', abortFromCaller)
  }
}
