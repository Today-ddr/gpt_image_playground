import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILE_RE = /^output-\d+\.(png|jpeg|webp)$/
const CONTENT_TYPE_BY_EXT = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

function jsonResponse(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function validateSubmission(value) {
  if (!value || typeof value !== 'object') throw new Error('请求内容无效')
  if (value.profile?.provider !== 'openai') throw new Error('后台任务仅支持 OpenAI 兼容接口')
  if (typeof value.profile.baseUrl !== 'string' || !value.profile.baseUrl.trim()) throw new Error('API URL 不能为空')
  if (typeof value.profile.apiKey !== 'string' || !value.profile.apiKey.trim()) throw new Error('API Key 不能为空')
  if (typeof value.profile.model !== 'string' || !value.profile.model.trim()) throw new Error('模型不能为空')
  if (value.profile.apiMode !== 'images' && value.profile.apiMode !== 'responses') throw new Error('API 模式无效')
  if (typeof value.prompt !== 'string' || !value.prompt.trim()) throw new Error('提示词不能为空')
  if (!value.params || typeof value.params !== 'object') throw new Error('生成参数无效')
  if (!Array.isArray(value.inputImageDataUrls)) throw new Error('输入图片无效')
  return value
}

export function createJobRequestHandler({ service, dataDir }) {
  return async (request) => {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/jobs/health') {
      return jsonResponse({ status: 'ok' })
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-zA-Z0-9_-]{1,128})$/)
    if (jobMatch && request.method === 'GET') {
      const job = await service.get(jobMatch[1])
      return job ? jsonResponse(job) : jsonResponse({ error: '任务不存在' }, 404)
    }

    if (jobMatch && request.method === 'PUT') {
      try {
        const submission = validateSubmission(await request.json())
        return jsonResponse(await service.submit(jobMatch[1], submission), 202)
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400)
      }
    }

    const fileMatch = url.pathname.match(/^\/api\/job-files\/([a-zA-Z0-9_-]{1,128})\/([^/]+)$/)
    if (fileMatch && request.method === 'GET' && FILE_RE.test(fileMatch[2])) {
      try {
        const bytes = await readFile(join(dataDir, fileMatch[1], fileMatch[2]))
        const ext = fileMatch[2].split('.').pop()
        return new Response(bytes, {
          headers: {
            'Content-Type': CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
          },
        })
      } catch (err) {
        if (err?.code === 'ENOENT') return jsonResponse({ error: '结果文件不存在' }, 404)
        throw err
      }
    }

    return jsonResponse({ error: '接口不存在' }, 404)
  }
}
