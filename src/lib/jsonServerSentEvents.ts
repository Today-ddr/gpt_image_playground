import { appendStreamingFormatHint } from './imageApiShared'

export interface ReadJsonServerSentEventsOptions {
  signals?: Array<AbortSignal | undefined>
  failedEventFallback?: string
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function getStreamEventErrorMessage(event: Record<string, unknown>, failedFallback: string): string | null {
  const error = event.error
  if (isRecordValue(error)) {
    const message = getStringValue(error, 'message')
    if (message) return message
  }
  if (typeof error === 'string' && error.trim()) return error

  const type = getStringValue(event, 'type')
  if (type?.endsWith('.failed')) return getStringValue(event, 'message') ?? failedFallback
  return null
}

export function parseServerSentEventBlock(block: string): string | null {
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue
    dataLines.push(line.slice(5).replace(/^ /, ''))
  }

  const data = dataLines.join('\n').trim()
  if (!data || data === '[DONE]') return null
  return data
}

function isFlushableSseDataLine(line: string): boolean {
  if (!line.startsWith('data:')) return false
  const payload = line.slice(5).replace(/^ /, '').trim()
  if (!payload || payload === '[DONE]') return true
  try {
    JSON.parse(payload)
    return true
  } catch {
    return false
  }
}

/** 中转常把 SSE 收成单换行、没有 `\n\n`。完整 JSON/`[DONE]` 的 data 行先刷出，半截 JSON 留在缓冲。 */
function takeCompleteSingleLineSseBlocks(buffer: string): { blocks: string[]; rest: string } {
  const blocks: string[] = []
  let offset = 0
  let blockStart = 0

  while (offset < buffer.length) {
    const slice = buffer.slice(offset)
    const match = slice.match(/\r?\n/)
    if (!match || match.index == null) break

    const line = slice.slice(0, match.index)
    const nextOffset = offset + match.index + match[0].length

    if (line.startsWith('data:') && !isFlushableSseDataLine(line)) break

    if (line.startsWith('data:') && isFlushableSseDataLine(line)) {
      const block = buffer.slice(blockStart, nextOffset).replace(/(?:\r?\n)+$/, '')
      if (block.trim()) blocks.push(block)
      blockStart = nextOffset
    }

    offset = nextOffset
  }

  return { blocks, rest: buffer.slice(blockStart) }
}

export function takeCompleteSseBlocks(buffer: string): { blocks: string[]; rest: string } {
  const blocks: string[] = []
  let rest = buffer

  while (true) {
    const match = rest.match(/\r?\n\r?\n/)
    if (!match || match.index == null) break
    const block = rest.slice(0, match.index)
    rest = rest.slice(match.index + match[0].length)
    if (block.trim()) blocks.push(block)
  }

  const flushed = takeCompleteSingleLineSseBlocks(rest)
  blocks.push(...flushed.blocks)
  return { blocks, rest: flushed.rest }
}

export function getAbortedSignal(signals: Array<AbortSignal | undefined>) {
  return signals.find((signal) => signal?.aborted)
}

export function throwIfAborted(...signals: Array<AbortSignal | undefined>) {
  const signal = getAbortedSignal(signals)
  if (!signal) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('请求已停止', 'AbortError')
}

export async function readJsonServerSentEvents(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void | Promise<void>,
  options: ReadJsonServerSentEventsOptions = {},
): Promise<void> {
  if (!response.body) throw new Error('接口未返回可读取的流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const signals = (options.signals ?? []).filter((signal): signal is AbortSignal => Boolean(signal))
  const failedEventFallback = options.failedEventFallback ?? '流式请求失败'
  let buffer = ''
  let hasDataLine = false
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined)
  }
  throwIfAborted(...signals)
  for (const signal of signals) signal.addEventListener('abort', cancelReader, { once: true })

  const processBlock = async (block: string) => {
    if (block.split(/\r?\n/).some((line) => line.startsWith('data:'))) hasDataLine = true
    const data = parseServerSentEventBlock(block)
    if (!data) return

    let event: unknown
    try {
      event = JSON.parse(data)
    } catch {
      throw new Error(appendStreamingFormatHint(data))
    }
    if (!isRecordValue(event)) return

    const errorMessage = getStreamEventErrorMessage(event, failedEventFallback)
    if (errorMessage) throw new Error(errorMessage)

    throwIfAborted(...signals)
    await onEvent(event)
    await Promise.resolve()
    throwIfAborted(...signals)
  }

  try {
    while (true) {
      throwIfAborted(...signals)
      const { value, done } = await reader.read()
      throwIfAborted(...signals)
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const taken = takeCompleteSseBlocks(buffer)
      buffer = taken.rest
      for (const block of taken.blocks) await processBlock(block)
    }

    buffer += decoder.decode()
    throwIfAborted(...signals)
    const trailing = takeCompleteSseBlocks(buffer)
    for (const block of trailing.blocks) await processBlock(block)
    if (trailing.rest.trim()) await processBlock(trailing.rest)
    if (!hasDataLine) throw new Error(appendStreamingFormatHint('未从流式响应中解析到有效的 data 事件'))
  } finally {
    for (const signal of signals) signal.removeEventListener('abort', cancelReader)
  }
}
