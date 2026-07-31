import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { getImageJob, getImageJobExecutionPreference, isImageJobApiAvailable, submitImageJob } from './imageJobApi'

function submission() {
  return {
    profile: createDefaultOpenAIProfile({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      model: 'gpt-image-1',
    }),
    prompt: '一只白色杯子',
    params: { ...DEFAULT_PARAMS },
    inputImageDataUrls: [],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('image job API', () => {
  it('reports health only for a valid successful response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'starting' }), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(isImageJobApiAvailable()).resolves.toBe(true)
    await expect(isImageJobApiAvailable()).resolves.toBe(false)
    await expect(isImageJobApiAvailable()).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs/health', expect.objectContaining({ cache: 'no-store' }))
  })

  it.each([
    [{ status: 'ok' }, { executionMode: 'server', requiresConfirmation: false }],
    [{ status: 'starting' }, { executionMode: 'browser', requiresConfirmation: true }],
  ])('maps health response %j to execution preference', async (health, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(health))))

    await expect(getImageJobExecutionPreference()).resolves.toEqual(expected)
  })

  it('submits the same task id with an idempotent PUT request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'task-a',
      status: 'running',
      createdAt: 1,
      startedAt: 1,
      finishedAt: null,
      error: null,
      resultUrls: [],
    }), { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await submitImageJob('task-a', submission())
    await submitImageJob('task-a', submission())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(firstCall[0]).toBe('/api/jobs/task-a')
    expect(firstCall[1]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it.each(['running', 'done', 'error', 'interrupted'] as const)('parses %s job status', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'task-a',
      status,
      createdAt: 1,
      startedAt: 1,
      finishedAt: status === 'running' ? null : 2,
      error: status === 'error' ? 'quota exceeded' : null,
      resultUrls: status === 'done' ? ['/api/job-files/task-a/output-1.png'] : [],
      actualParams: status === 'done' ? { size: '1024x1024' } : undefined,
    }))))

    await expect(getImageJob('task-a')).resolves.toMatchObject({ id: 'task-a', status })
  })

  it('returns null for a missing job', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '任务不存在' }), { status: 404 })))

    await expect(getImageJob('missing')).resolves.toBeNull()
  })

  it('rejects malformed responses and surfaces API errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'mystery' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '请求内容无效' }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getImageJob('task-a')).rejects.toThrow('后台任务响应格式无效')
    await expect(submitImageJob('task-a', submission())).rejects.toThrow('请求内容无效')
  })
})
