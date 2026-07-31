import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DEFAULT_RETENTION_MS = 168 * 60 * 60 * 1000
const TERMINAL_STATUSES = new Set(['done', 'error', 'interrupted'])
const TASK_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/

function validateTaskId(taskId) {
  if (!TASK_ID_RE.test(taskId)) throw new Error('任务 ID 无效')
}

function jobPath(dataDir, taskId) {
  validateTaskId(taskId)
  return join(dataDir, taskId, 'job.json')
}

async function readJob(dataDir, taskId) {
  try {
    return JSON.parse(await readFile(jobPath(dataDir, taskId), 'utf8'))
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

async function atomicWrite(path, value) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await writeFile(tempPath, value)
  await rename(tempPath, path)
}

async function writeJob(dataDir, job) {
  const dir = join(dataDir, job.id)
  await mkdir(dir, { recursive: true })
  await atomicWrite(join(dir, 'job.json'), JSON.stringify(job, null, 2))
}

function sanitizeRequest(submission) {
  return {
    provider: 'openai',
    baseUrl: submission.profile.baseUrl,
    model: submission.profile.model,
    timeout: submission.profile.timeout,
    apiMode: submission.profile.apiMode,
    codexCli: Boolean(submission.profile.codexCli),
    responseFormatB64Json: Boolean(submission.profile.responseFormatB64Json),
    streamImages: Boolean(submission.profile.streamImages),
    prompt: submission.prompt,
    params: submission.params,
    inputImageCount: submission.inputImageDataUrls.length,
    hasMask: Boolean(submission.maskDataUrl),
  }
}

function sanitizeError(err, apiKey) {
  const message = err instanceof Error ? err.message : String(err)
  if (!apiKey) return message
  return message.split(apiKey).join('[REDACTED]')
}

async function writeOutputs(dataDir, taskId, images) {
  const resultUrls = []
  const dir = join(dataDir, taskId)
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    const ext = /^[a-z0-9]+$/i.test(image.ext) ? image.ext.toLowerCase() : 'png'
    const fileName = `output-${index + 1}.${ext}`
    await atomicWrite(join(dir, fileName), image.bytes)
    resultUrls.push(`/api/job-files/${taskId}/${fileName}`)
  }
  return resultUrls
}

export async function initializeJobStore(dataDir, options = {}) {
  const now = options.now ?? Date.now
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
  await mkdir(dataDir, { recursive: true })

  const entries = await readdir(dataDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !TASK_ID_RE.test(entry.name)) continue
    const job = await readJob(dataDir, entry.name)
    if (!job) continue

    if (job.status === 'running') {
      await writeJob(dataDir, {
        ...job,
        status: 'interrupted',
        error: '后台任务服务已重启，任务已中断且不会自动重试。',
        finishedAt: now(),
      })
      continue
    }

    if (TERMINAL_STATUSES.has(job.status) && Number.isFinite(job.finishedAt) && now() - job.finishedAt >= retentionMs) {
      await rm(join(dataDir, entry.name), { recursive: true, force: true })
    }
  }
}

export async function cleanupExpiredJobs(dataDir, options = {}) {
  const now = options.now ?? Date.now
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
  const entries = await readdir(dataDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !TASK_ID_RE.test(entry.name)) continue
    const job = await readJob(dataDir, entry.name)
    if (!job || !TERMINAL_STATUSES.has(job.status) || !Number.isFinite(job.finishedAt)) continue
    if (now() - job.finishedAt >= retentionMs) {
      await rm(join(dataDir, entry.name), { recursive: true, force: true })
    }
  }
}

export async function createJobService({ dataDir, execute, now = Date.now, retentionMs = DEFAULT_RETENTION_MS }) {
  await initializeJobStore(dataDir, { now, retentionMs })
  const activeSubmissions = new Map()
  const cleanupTimer = setInterval(() => {
    void cleanupExpiredJobs(dataDir, { now, retentionMs })
  }, 60 * 60 * 1000)
  cleanupTimer.unref?.()

  const service = {
    async get(taskId) {
      validateTaskId(taskId)
      return readJob(dataDir, taskId)
    },

    async submit(taskId, submission) {
      validateTaskId(taskId)
      const active = activeSubmissions.get(taskId)
      if (active) return active

      const operation = (async () => {
        const existing = await readJob(dataDir, taskId)
        if (existing) return existing

        const startedAt = now()
        const job = {
          id: taskId,
          status: 'running',
          createdAt: startedAt,
          startedAt,
          finishedAt: null,
          error: null,
          resultUrls: [],
          request: sanitizeRequest(submission),
        }
        await writeJob(dataDir, job)

        void Promise.resolve()
          .then(() => execute(submission))
          .then(async (result) => {
            const resultUrls = await writeOutputs(dataDir, taskId, result.images ?? [])
            await writeJob(dataDir, {
              ...job,
              status: 'done',
              finishedAt: now(),
              resultUrls,
              actualParams: result.actualParams,
              actualParamsList: result.actualParamsList,
              revisedPrompts: result.revisedPrompts,
              rawImageUrls: result.rawImageUrls,
              failedRequests: result.failedRequests,
            })
          })
          .catch(async (err) => {
            await writeJob(dataDir, {
              ...job,
              status: 'error',
              error: sanitizeError(err, submission.profile.apiKey),
              finishedAt: now(),
            })
          })

        return job
      })()
      activeSubmissions.set(taskId, operation)
      try {
        return await operation
      } finally {
        activeSubmissions.delete(taskId)
      }
    },
    async cleanup() {
      await cleanupExpiredJobs(dataDir, { now, retentionMs })
    },
  }
  return service
}
