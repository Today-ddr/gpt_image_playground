const MIME_BY_FORMAT = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}
const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
}
const PROMPT_REWRITE_GUARD_PREFIX = 'Use the following text as the complete prompt. Do not rewrite it:'

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl ?? '').trim()
  if (!trimmed) return ''
  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(input)
  const segments = url.pathname.split('/').filter(Boolean)
  const v1Index = segments.indexOf('v1')
  const normalized = v1Index >= 0 ? segments.slice(0, v1Index + 1) : segments.length ? [...segments, 'v1'] : []
  return `${url.origin}${normalized.length ? `/${normalized.join('/')}` : ''}`
}

function buildApiUrl(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl)
  const endpoint = path.replace(/^\/+/, '')
  return base.endsWith('/v1') ? `${base}/${endpoint}` : `${base}/v1/${endpoint}`
}

function pickActualParams(source) {
  if (!source || typeof source !== 'object') return undefined
  const result = {}
  if (typeof source.size === 'string') result.size = source.size
  if (['auto', 'low', 'medium', 'high'].includes(source.quality)) result.quality = source.quality
  if (['png', 'jpeg', 'webp'].includes(source.output_format)) result.output_format = source.output_format
  if (typeof source.output_compression === 'number') result.output_compression = source.output_compression
  if (['auto', 'low'].includes(source.moderation)) result.moderation = source.moderation
  if (typeof source.n === 'number') result.n = source.n
  return Object.keys(result).length ? result : undefined
}

function mergeActualParams(...values) {
  const result = Object.assign({}, ...values.filter(Boolean))
  return Object.keys(result).length ? result : undefined
}

function decodeBase64Image(value, fallbackMime) {
  const match = String(value).match(/^data:([^;,]+);base64,(.*)$/s)
  const mime = match?.[1] || fallbackMime
  const base64 = match?.[2] ?? String(value)
  return {
    bytes: new Uint8Array(Buffer.from(base64, 'base64')),
    mime,
    ext: EXT_BY_MIME[mime] ?? 'png',
  }
}

function dataUrlToFile(dataUrl, fileName) {
  const image = decodeBase64Image(dataUrl, 'image/png')
  return new File([image.bytes], fileName, { type: image.mime })
}

async function downloadImage(url, fallbackMime, fetchImpl, signal) {
  const response = await fetchImpl(url, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  const mime = response.headers.get('Content-Type')?.split(';')[0].trim() || fallbackMime
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mime,
    ext: EXT_BY_MIME[mime] ?? EXT_BY_MIME[fallbackMime] ?? 'png',
  }
}

async function getApiErrorMessage(response) {
  const text = await response.text()
  try {
    const value = JSON.parse(text)
    return value?.error?.message ?? value?.detail ?? value?.message ?? `HTTP ${response.status}`
  } catch {
    return text.trim() || `HTTP ${response.status}`
  }
}

function parseSseEvents(text) {
  const events = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
      .trim()
    if (!data || data === '[DONE]') continue
    const event = JSON.parse(data)
    const message = event?.error?.message ?? (typeof event?.error === 'string' ? event.error : undefined)
    if (message) throw new Error(message)
    if (typeof event?.type === 'string' && event.type.endsWith('.failed')) {
      throw new Error(event.message || '流式请求失败')
    }
    events.push(event)
  }
  return events
}

async function parseImageCandidates(items, fallbackMime, fetchImpl, signal) {
  const images = []
  const revisedPrompts = []
  const actualParamsList = []
  const rawImageUrls = []
  for (const item of items) {
    const b64 = typeof item?.b64_json === 'string' ? item.b64_json : null
    const url = typeof item?.url === 'string' ? item.url : null
    if (!b64 && !url) continue
    if (url) rawImageUrls.push(url)
    images.push(b64
      ? decodeBase64Image(b64, fallbackMime)
      : await downloadImage(url, fallbackMime, fetchImpl, signal))
    revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined)
    actualParamsList.push(pickActualParams(item))
  }
  if (!images.length) throw new Error('接口未返回可识别的图片数据')
  return {
    images,
    revisedPrompts,
    actualParamsList,
    rawImageUrls: rawImageUrls.length ? rawImageUrls : undefined,
  }
}

async function parseImagesResponse(response, fallbackMime, fetchImpl, signal) {
  if (response.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream')) {
    const events = parseSseEvents(await response.text())
    const resultEvent = events.findLast((event) => event.object === 'image.generation.result' || event.object === 'image.edit.result')
    if (resultEvent) return parseImageCandidates(Array.isArray(resultEvent.data) ? resultEvent.data : [], fallbackMime, fetchImpl, signal)
    const completed = events.filter((event) => event.type === 'image_generation.completed' || event.type === 'image_edit.completed')
    return parseImageCandidates(completed, fallbackMime, fetchImpl, signal)
  }

  const payload = await response.json()
  const parsed = await parseImageCandidates(Array.isArray(payload.data) ? payload.data : [], fallbackMime, fetchImpl, signal)
  return { ...parsed, actualParams: mergeActualParams(pickActualParams(payload), parsed.actualParamsList[0]) }
}

function getResponseImageValue(result) {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return null
  return result.b64_json ?? result.base64 ?? result.image ?? result.data ?? null
}

async function parseResponsesResponse(response, fallbackMime) {
  const payload = response.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream')
    ? (() => {
        const eventsPromise = response.text().then(parseSseEvents)
        return eventsPromise.then((events) => {
          const completed = events.findLast((event) => event.response && typeof event.response === 'object')
          if (completed) return completed.response
          return {
            output: events
              .filter((event) => event.type === 'response.output_item.done' && event.item)
              .map((event) => event.item),
          }
        })
      })()
    : response.json()
  const resolvedPayload = await payload
  const items = Array.isArray(resolvedPayload.output)
    ? resolvedPayload.output.filter((item) => item?.type === 'image_generation_call')
    : []
  const images = []
  const revisedPrompts = []
  const actualParamsList = []
  for (const item of items) {
    const value = getResponseImageValue(item.result)
    if (!value) continue
    images.push(decodeBase64Image(value, fallbackMime))
    revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined)
    actualParamsList.push(pickActualParams(item))
  }
  if (!images.length) throw new Error('接口未返回可识别的图片数据')
  return {
    images,
    revisedPrompts,
    actualParamsList,
    actualParams: mergeActualParams(actualParamsList[0]),
  }
}

function createResponsesInput(submission) {
  const guard = !submission.allowPromptRewrite && !submission.sendPromptAsIs
  const text = guard ? `${PROMPT_REWRITE_GUARD_PREFIX}\n${submission.prompt}` : submission.prompt
  if (!submission.inputImageDataUrls.length) return text
  return [{
    role: 'user',
    content: [
      { type: 'input_text', text },
      ...submission.inputImageDataUrls.map((image_url) => ({ type: 'input_image', image_url })),
    ],
  }]
}

function createResponsesTool(submission) {
  const params = submission.params
  const tool = {
    type: 'image_generation',
    action: submission.inputImageDataUrls.length ? 'edit' : 'generate',
    size: params.size,
    output_format: params.output_format,
    moderation: params.moderation,
  }
  if (!submission.profile.codexCli) tool.quality = params.quality
  if (params.output_format !== 'png' && params.output_compression != null) tool.output_compression = params.output_compression
  if (submission.profile.streamImages) tool.partial_images = submission.profile.streamPartialImages ?? 2
  if (submission.maskDataUrl) tool.input_image_mask = { image_url: submission.maskDataUrl }
  return tool
}

async function executeSingleImagesRequest(submission, fetchImpl) {
  const profile = submission.profile
  const params = submission.params
  const isEdit = submission.inputImageDataUrls.length > 0
  const fallbackMime = MIME_BY_FORMAT[params.output_format] ?? 'image/png'
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1, profile.timeout) * 1000)
  const guardedPrompt = profile.codexCli && !submission.allowPromptRewrite && !submission.sendPromptAsIs
    ? `${PROMPT_REWRITE_GUARD_PREFIX}\n${submission.prompt}`
    : submission.prompt

  try {
    let body
    let headers = { Authorization: `Bearer ${profile.apiKey}` }
    if (isEdit) {
      body = new FormData()
      body.append('model', profile.model)
      body.append('prompt', guardedPrompt)
      body.append('size', params.size)
      body.append('output_format', params.output_format)
      body.append('moderation', params.moderation)
      if (!profile.codexCli) body.append('quality', params.quality)
      if (params.output_format !== 'png' && params.output_compression != null) body.append('output_compression', String(params.output_compression))
      if (params.n > 1) body.append('n', String(params.n))
      if (profile.responseFormatB64Json) body.append('response_format', 'b64_json')
      if (profile.streamImages) {
        body.append('stream', 'true')
        body.append('partial_images', String(profile.streamPartialImages ?? 2))
      }
      submission.inputImageDataUrls.forEach((dataUrl, index) => {
        const file = dataUrlToFile(dataUrl, `input-${index + 1}.png`)
        body.append('image[]', file)
      })
      if (submission.maskDataUrl) body.append('mask', dataUrlToFile(submission.maskDataUrl, 'mask.png'))
    } else {
      body = {
        model: profile.model,
        prompt: guardedPrompt,
        size: params.size,
        output_format: params.output_format,
        moderation: params.moderation,
      }
      if (!profile.codexCli) body.quality = params.quality
      if (params.output_format !== 'png' && params.output_compression != null) body.output_compression = params.output_compression
      if (params.n > 1) body.n = params.n
      if (profile.responseFormatB64Json) body.response_format = 'b64_json'
      if (profile.streamImages) {
        body.stream = true
        body.partial_images = profile.streamPartialImages ?? 2
      }
      headers = { ...headers, 'Content-Type': 'application/json' }
      body = JSON.stringify(body)
    }

    const response = await fetchImpl(buildApiUrl(profile.baseUrl, isEdit ? 'images/edits' : 'images/generations'), {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(await getApiErrorMessage(response))
    return parseImagesResponse(response, fallbackMime, fetchImpl, controller.signal)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function executeSingleResponsesRequest(submission, fetchImpl) {
  const profile = submission.profile
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1, profile.timeout) * 1000)
  try {
    const body = {
      model: profile.model,
      input: createResponsesInput(submission),
      tools: [createResponsesTool(submission)],
      tool_choice: 'required',
      ...(profile.streamImages ? { stream: true } : {}),
    }
    const response = await fetchImpl(buildApiUrl(profile.baseUrl, 'responses'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(await getApiErrorMessage(response))
    return parseResponsesResponse(response, MIME_BY_FORMAT[submission.params.output_format] ?? 'image/png')
  } finally {
    clearTimeout(timeoutId)
  }
}

function mergeResults(results, requestedCount) {
  const successful = results.filter((result) => result.status === 'fulfilled').map((result) => result.value)
  if (!successful.length) throw results.find((result) => result.status === 'rejected')?.reason ?? new Error('所有并发请求均失败')
  const images = successful.flatMap((result) => result.images)
  const actualParamsList = successful.flatMap((result) => result.actualParamsList ?? result.images.map(() => result.actualParams))
  const revisedPrompts = successful.flatMap((result) => result.revisedPrompts ?? result.images.map(() => undefined))
  const rawImageUrls = successful.flatMap((result) => result.rawImageUrls ?? [])
  const failedRequests = results.flatMap((result, requestIndex) => result.status === 'rejected'
    ? [{ requestIndex, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
    : [])
  return {
    images,
    actualParams: mergeActualParams(successful[0].actualParams, { n: images.length || requestedCount }),
    actualParamsList,
    revisedPrompts,
    ...(rawImageUrls.length ? { rawImageUrls } : {}),
    ...(failedRequests.length ? { failedRequests } : {}),
  }
}

export async function executeOpenAIJob(submission, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const count = Math.max(1, submission.params.n || 1)
  const executeSingle = submission.profile.apiMode === 'responses'
    ? executeSingleResponsesRequest
    : executeSingleImagesRequest
  const splitRequests = submission.profile.apiMode === 'responses'
    || submission.profile.codexCli
    || submission.profile.streamImages
  if (count === 1 || !splitRequests) return executeSingle(submission, fetchImpl)

  const singleSubmission = {
    ...submission,
    params: {
      ...submission.params,
      n: 1,
      ...(submission.profile.codexCli ? { quality: 'auto' } : {}),
    },
  }
  return mergeResults(await Promise.allSettled(
    Array.from({ length: count }, () => executeSingle(singleSubmission, fetchImpl)),
  ), count)
}
