import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJobService } from './jobService.mjs'
import { createJobRequestHandler } from './httpApi.mjs'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function submission() {
  return {
    profile: {
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
      model: 'gpt-image-1',
      timeout: 120,
      apiMode: 'images',
      codexCli: false,
      responseFormatB64Json: true,
      streamImages: false,
    },
    prompt: 'cup',
    params: {
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      n: 1,
      transparent_output: false,
    },
    inputImageDataUrls: [],
  }
}

describe('job HTTP API', () => {
  it('serves health and missing-job responses', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'gpt-image-http-'))
    dirs.push(dataDir)
    const service = await createJobService({ dataDir, execute: vi.fn() })
    const handle = createJobRequestHandler({ service, dataDir })

    const health = await handle(new Request('http://local/api/jobs/health'))
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })

    const missing = await handle(new Request('http://local/api/jobs/missing'))
    expect(missing.status).toBe(404)
  })

  it('accepts, queries, and serves a completed job result', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'gpt-image-http-'))
    dirs.push(dataDir)
    const service = await createJobService({
      dataDir,
      execute: vi.fn(async () => ({
        images: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', ext: 'png' }],
      })),
    })
    const handle = createJobRequestHandler({ service, dataDir })

    const accepted = await handle(new Request('http://local/api/jobs/task-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission()),
    }))
    expect(accepted.status).toBe(202)

    await vi.waitFor(async () => {
      const response = await handle(new Request('http://local/api/jobs/task-a'))
      expect((await response.json()).status).toBe('done')
    })

    const file = await handle(new Request('http://local/api/job-files/task-a/output-1.png'))
    expect(file.status).toBe(200)
    expect(file.headers.get('Cache-Control')).toBe('no-store')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('rejects malformed submissions without starting a job', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'gpt-image-http-'))
    dirs.push(dataDir)
    const execute = vi.fn()
    const service = await createJobService({ dataDir, execute })
    const handle = createJobRequestHandler({ service, dataDir })

    const response = await handle(new Request('http://local/api/jobs/task-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    }))

    expect(response.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })
})
