import { describe, expect, it, vi } from 'vitest'
import { executeOpenAIJob } from './openaiExecutor.mjs'

function submission(overrides: Record<string, unknown> = {}) {
  return {
    profile: {
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      model: 'gpt-image-1',
      timeout: 120,
      apiMode: 'images',
      codexCli: false,
      responseFormatB64Json: true,
      streamImages: false,
      streamPartialImages: 2,
    },
    prompt: 'white cup',
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
    allowPromptRewrite: false,
    ...overrides,
  }
}

describe('OpenAI job executor', () => {
  it('executes an Images API request and decodes base64 output', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: 'AQID', revised_prompt: 'revised' }],
    }), { headers: { 'Content-Type': 'application/json' } }))

    const result = await executeOpenAIJob(submission(), { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/images/generations')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-key', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-image-1',
      prompt: 'white cup',
      size: '1024x1024',
      quality: 'high',
      response_format: 'b64_json',
    })
    expect(result.images).toEqual([{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', ext: 'png' }])
    expect(result.revisedPrompts).toEqual(['revised'])
  })

  it('downloads HTTP image results before completing the job', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/result.webp' }] }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5]), {
        headers: { 'Content-Type': 'image/webp' },
      }))

    const result = await executeOpenAIJob(submission({
      params: { ...submission().params, output_format: 'webp' },
    }), { fetchImpl })

    expect(fetchImpl.mock.calls[1][0]).toBe('https://cdn.example.com/result.webp')
    expect(result.images[0]).toEqual({ bytes: new Uint8Array([4, 5]), mime: 'image/webp', ext: 'webp' })
    expect(result.rawImageUrls).toEqual(['https://cdn.example.com/result.webp'])
  })

  it('executes a Responses API request and reads image_generation_call output', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        result: 'AQID',
        revised_prompt: 'response revised',
        size: '1024x1024',
      }],
    }), { headers: { 'Content-Type': 'application/json' } }))
    const value = submission()
    value.profile.apiMode = 'responses'

    const result = await executeOpenAIJob(value, { fetchImpl })

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/v1/responses')
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toMatchObject({
      model: 'gpt-image-1',
      tool_choice: 'required',
    })
    expect(result.images[0].bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(result.actualParams).toEqual({ size: '1024x1024' })
  })

  it('consumes Images API server-sent events but keeps only the final image', async () => {
    const stream = [
      { type: 'image_generation.partial_image', b64_json: 'BAU=' },
      { type: 'image_generation.completed', b64_json: 'AQID', size: '1024x1024', output_format: 'png' },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
    const fetchImpl = vi.fn(async () => new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const value = submission()
    value.profile.streamImages = true

    const result = await executeOpenAIJob(value, { fetchImpl })

    expect(result.images).toEqual([{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', ext: 'png' }])
  })

  it('uses multipart form data for image edits', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    const value = submission({
      inputImageDataUrls: ['data:image/png;base64,AQID'],
      maskDataUrl: 'data:image/png;base64,BAUG',
    })

    await executeOpenAIJob(value, { fetchImpl })

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/v1/images/edits')
    const body = fetchImpl.mock.calls[0][1].body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.getAll('image[]')).toHaveLength(1)
    expect(body.get('mask')).toBeInstanceOf(File)
  })

  it('surfaces the upstream API error message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(executeOpenAIJob(submission(), { fetchImpl })).rejects.toThrow('quota exceeded')
  })
})
