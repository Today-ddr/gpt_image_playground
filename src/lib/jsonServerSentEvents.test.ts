import { describe, expect, it } from 'vitest'
import { readJsonServerSentEvents, takeCompleteSseBlocks } from './jsonServerSentEvents'

describe('takeCompleteSseBlocks', () => {
  it('flushes complete JSON data lines without blank-line separators', () => {
    const { blocks, rest } = takeCompleteSseBlocks('data: {"a":1}\ndata: {"b":2}\ndata: {"c":')
    expect(blocks).toEqual(['data: {"a":1}', 'data: {"b":2}'])
    expect(rest).toBe('data: {"c":')
  })

  it('keeps incomplete JSON in the buffer until it is valid', () => {
    const { blocks, rest } = takeCompleteSseBlocks('data: {"a":1}\ndata: {"type":"partial"')
    expect(blocks).toEqual(['data: {"a":1}'])
    expect(rest).toBe('data: {"type":"partial"')
  })

  it('splits blank-line framed events first', () => {
    const { blocks, rest } = takeCompleteSseBlocks('data: {"a":1}\n\ndata: {"b":2}\n\npartial')
    expect(blocks).toEqual(['data: {"a":1}', 'data: {"b":2}'])
    expect(rest).toBe('partial')
  })

  it('flushes [DONE] data lines', () => {
    const { blocks, rest } = takeCompleteSseBlocks('data: [DONE]\n')
    expect(blocks).toEqual(['data: [DONE]'])
    expect(rest).toBe('')
  })
})

describe('readJsonServerSentEvents', () => {
  it('emits mid-stream events when the proxy only uses single newlines', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"a"}\ndata: {"type":"b"}\n'))
        controller.close()
      },
    })
    const events: Array<Record<string, unknown>> = []

    await readJsonServerSentEvents(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }), (event) => {
      events.push(event)
    })

    expect(events).toEqual([{ type: 'a' }, { type: 'b' }])
  })

  it('stops reading when an abort signal fires after an event', async () => {
    const encoder = new TextEncoder()
    const abortController = new AbortController()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"a"}\n\n'))
        controller.close()
      },
    })
    const events: string[] = []

    await expect(readJsonServerSentEvents(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }), (event) => {
      events.push(String(event.type))
      abortController.abort()
    }, { signals: [abortController.signal] })).rejects.toMatchObject({ name: 'AbortError' })

    expect(events).toEqual(['a'])
  })

  it('throws when a stream event reports failure', async () => {
    const streamBody = 'data: {"type":"response.failed","message":"boom"}\n\n'
    await expect(readJsonServerSentEvents(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }), () => undefined, { failedEventFallback: 'Agent 流式请求失败' })).rejects.toThrow('boom')
  })
})
