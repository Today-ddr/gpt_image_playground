import type { ApiProfile } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'

class ApiModelsError extends Error {}

export async function fetchApiModels(profile: ApiProfile): Promise<string[]> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  if (!profile.apiKey.trim()) throw new Error('请先填写 API Key')
  if (!profile.baseUrl.trim() && !useApiProxy) throw new Error('请先填写 API URL')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)

  try {
    const response = await fetch(buildApiUrl(profile.baseUrl, 'models', proxyConfig, useApiProxy), {
      headers: { Authorization: `Bearer ${profile.apiKey.trim()}` },
      signal: controller.signal,
    })
    if (!response.ok) throw new ApiModelsError(`获取模型列表失败：HTTP ${response.status}`)

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new ApiModelsError('模型列表响应格式无效')
    }

    if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
      throw new ApiModelsError('模型列表响应格式无效')
    }

    const models = (body as { data: unknown[] }).data
      .map((item) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
        ? (item as { id: string }).id.trim()
        : '')
      .filter(Boolean)

    return Array.from(new Set(models)).sort((a, b) => a.localeCompare(b))
  } catch (err) {
    if (err instanceof ApiModelsError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') throw new Error('获取模型列表超时')
    throw new Error('获取模型列表失败，请检查网络、API URL 或跨域设置')
  } finally {
    clearTimeout(timeoutId)
  }
}
