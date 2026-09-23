import type { ApiProfile } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy, withApiProxyHeaders } from './devProxy'

type GenerateAfternoonTeaNoticeOptions = {
  profile: ApiProfile
  userPrompt: string
  systemPrompt: string
  signal?: AbortSignal
}

class AfternoonTeaNoticeError extends Error {}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => (
      part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text.trim()
        : ''
    ))
    .filter(Boolean)
    .join('\n')
}

export async function generateAfternoonTeaNotice(opts: GenerateAfternoonTeaNoticeOptions): Promise<string> {
  const profile = opts.profile
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)

  if (profile.provider !== 'openai') throw new Error('当前 API 配置不支持下午茶通知')
  if (!profile.understandingModel?.trim()) throw new Error('请先配置语义理解/多模态模型 ID')
  if (!profile.baseUrl.trim() && !useApiProxy) throw new Error('请先填写 API URL')
  if (!profile.apiKey.trim()) throw new Error('请先填写 API Key')
  if (!opts.userPrompt.trim()) throw new Error('请输入用户内容')
  if (!opts.systemPrompt.trim()) throw new Error('请输入系统提示词')
  if (opts.signal?.aborted) throw new Error('下午茶通知已取消')

  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, profile.timeout * 1000)
  const abortFromCaller = () => controller.abort()
  opts.signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const response = await fetch(buildApiUrl(profile.baseUrl, 'chat/completions', proxyConfig, useApiProxy), {
      method: 'POST',
      headers: withApiProxyHeaders(profile, {
        Authorization: `Bearer ${profile.apiKey.trim()}`,
        'Content-Type': 'application/json',
      }, proxyConfig),
      body: JSON.stringify({
        model: profile.understandingModel.trim(),
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: opts.systemPrompt.trim() },
          {
            role: 'user',
            content: [{ type: 'text', text: opts.userPrompt.trim() }],
          },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new AfternoonTeaNoticeError(`下午茶通知失败：HTTP ${response.status}`)

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new AfternoonTeaNoticeError('下午茶通知响应格式无效')
    }

    if (!body || typeof body !== 'object') throw new AfternoonTeaNoticeError('下午茶通知响应格式无效')
    const choices = (body as { choices?: unknown }).choices
    if (!Array.isArray(choices)) throw new AfternoonTeaNoticeError('下午茶通知响应格式无效')
    const message = choices[0] && typeof choices[0] === 'object'
      ? (choices[0] as { message?: unknown }).message
      : null
    const content = message && typeof message === 'object'
      ? (message as { content?: unknown }).content
      : null
    const text = extractContentText(content)
    if (!text) throw new AfternoonTeaNoticeError('下午茶通知结果为空')
    return text
  } catch (err) {
    if (err instanceof AfternoonTeaNoticeError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(timedOut ? '下午茶通知超时' : '下午茶通知已取消')
    }
    throw new Error('下午茶通知失败，请检查网络、API URL 或跨域设置')
  } finally {
    clearTimeout(timeoutId)
    opts.signal?.removeEventListener('abort', abortFromCaller)
  }
}
