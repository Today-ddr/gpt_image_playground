import http from 'node:http'
import { Readable } from 'node:stream'
import { createJobRequestHandler } from './httpApi.mjs'
import { createJobService } from './jobService.mjs'
import { executeOpenAIJob } from './openaiExecutor.mjs'

const host = process.env.JOB_API_HOST || '0.0.0.0'
const port = Number(process.env.JOB_API_PORT || 8787)
const dataDir = process.env.JOB_DATA_DIR || '/data/jobs'
const retentionHours = Number(process.env.JOB_RETENTION_HOURS || 168)
const retentionMs = Math.max(1, retentionHours) * 60 * 60 * 1000

const service = await createJobService({
  dataDir,
  retentionMs,
  execute: (submission) => executeOpenAIJob(submission),
})
const handle = createJobRequestHandler({ service, dataDir })

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET'
    const request = new Request(`http://${req.headers.host || `${host}:${port}`}${req.url || '/'}`, {
      method,
      headers: req.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(req),
      ...(method === 'GET' || method === 'HEAD' ? {} : { duplex: 'half' }),
    })
    const response = await handle(request)
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    if (!response.body) {
      res.end()
      return
    }
    for await (const chunk of response.body) res.write(Buffer.from(chunk))
    res.end()
  } catch (err) {
    console.error('Job API request failed:', err instanceof Error ? err.message : String(err))
    res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ error: '后台任务服务内部错误' }))
  }
})

server.listen(port, host, () => {
  console.log(`Image job API listening on ${host}:${port}`)
})
