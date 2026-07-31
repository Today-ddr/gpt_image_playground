import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJobService, initializeJobStore } from './jobService.mjs'

const dirs: string[] = []

async function createDataDir() {
  const dir = await mkdtemp(join(tmpdir(), 'gpt-image-jobs-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function submission(apiKey = 'secret-key') {
  return {
    profile: {
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey,
      model: 'gpt-image-1',
      timeout: 120,
      apiMode: 'images',
      codexCli: false,
      responseFormatB64Json: true,
      streamImages: false,
    },
    prompt: '一只白色杯子',
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

describe('job service', () => {
  it('persists a sanitized job before executing and completes it with a local result URL', async () => {
    const dataDir = await createDataDir()
    let release: (() => void) | undefined
    const started = new Promise<void>((resolve) => { release = resolve })
    const execute = vi.fn(async () => {
      await started
      return {
        images: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', ext: 'png' }],
        actualParams: { size: '1024x1024' },
      }
    })
    const service = await createJobService({ dataDir, execute })

    const accepted = await service.submit('task-a', submission())
    expect(accepted.status).toBe('running')
    expect(execute).toHaveBeenCalledTimes(1)

    const storedBeforeCompletion = await readFile(join(dataDir, 'task-a', 'job.json'), 'utf8')
    expect(storedBeforeCompletion).not.toContain('secret-key')
    expect(storedBeforeCompletion).not.toContain('inputImageDataUrls')
    expect(JSON.parse(storedBeforeCompletion)).toMatchObject({ id: 'task-a', status: 'running' })

    release?.()
    await vi.waitFor(async () => expect((await service.get('task-a'))?.status).toBe('done'))
    expect(await service.get('task-a')).toMatchObject({
      resultUrls: ['/api/job-files/task-a/output-1.png'],
      actualParams: { size: '1024x1024' },
    })
    expect(new Uint8Array(await readFile(join(dataDir, 'task-a', 'output-1.png')))).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('treats repeated task ids as idempotent', async () => {
    const dataDir = await createDataDir()
    const execute = vi.fn(async () => ({ images: [] }))
    const service = await createJobService({ dataDir, execute })

    await service.submit('task-a', submission())
    await service.submit('task-a', submission('other-key'))

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent submissions for the same task id', async () => {
    const dataDir = await createDataDir()
    let release: (() => void) | undefined
    const executeStarted = new Promise<void>((resolve) => { release = resolve })
    const execute = vi.fn(async () => {
      await executeStarted
      return { images: [] }
    })
    const service = await createJobService({ dataDir, execute })

    const first = service.submit('same-task', submission())
    const second = service.submit('same-task', submission('other-key'))
    const [firstJob, secondJob] = await Promise.all([first, second])

    expect(firstJob).toEqual(secondJob)
    expect(execute).toHaveBeenCalledTimes(1)
    release?.()
    await vi.waitFor(async () => expect((await service.get('same-task'))?.status).toBe('done'))
  })

  it('marks persisted running jobs interrupted on service startup', async () => {
    const dataDir = await createDataDir()
    const jobDir = join(dataDir, 'task-a')
    await mkdir(jobDir, { recursive: true })
    await writeFile(join(jobDir, 'job.json'), JSON.stringify({
      id: 'task-a',
      status: 'running',
      createdAt: 10,
      startedAt: 20,
      finishedAt: null,
      error: null,
      resultUrls: [],
      request: { model: 'gpt-image-1' },
    }))

    await initializeJobStore(dataDir, { now: () => 50 })

    expect(JSON.parse(await readFile(join(jobDir, 'job.json'), 'utf8'))).toMatchObject({
      status: 'interrupted',
      finishedAt: 50,
    })
  })

  it('removes expired terminal job directories but keeps recent jobs', async () => {
    const dataDir = await createDataDir()
    for (const [id, finishedAt] of [['expired', 1], ['recent', 9_500]] as const) {
      const jobDir = join(dataDir, id)
      await mkdir(jobDir, { recursive: true })
      await writeFile(join(jobDir, 'job.json'), JSON.stringify({ id, status: 'done', finishedAt }))
    }

    await initializeJobStore(dataDir, { now: () => 10_000, retentionMs: 1_000 })

    expect(await readdir(dataDir)).toEqual(['recent'])
  })

  it('rejects unsafe task ids', async () => {
    const dataDir = await createDataDir()
    const service = await createJobService({ dataDir, execute: vi.fn() })

    await expect(service.submit('../outside', submission())).rejects.toThrow('任务 ID 无效')
  })
})
