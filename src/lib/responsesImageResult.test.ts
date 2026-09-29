import { describe, expect, it, vi } from 'vitest'
import {
  getImageGenerationItemFromEvent,
  getResponsesImageResultSource,
  mergeResponsesOutputItem,
  resolveResponsesImageResultDataUrl,
} from './responsesImageResult'

describe('getResponsesImageResultSource', () => {
  it('classifies HTTP and data URL strings as urls instead of fake base64', () => {
    expect(getResponsesImageResultSource('https://cdn.example/a.png')).toEqual({
      kind: 'url',
      value: 'https://cdn.example/a.png',
    })
    expect(getResponsesImageResultSource('data:image/png;base64,ZmluYWw=')).toEqual({
      kind: 'url',
      value: 'data:image/png;base64,ZmluYWw=',
    })
    expect(getResponsesImageResultSource('ZmluYWw=')).toEqual({
      kind: 'b64',
      value: 'ZmluYWw=',
    })
  })

  it('reads object url fields after inline base64 keys', () => {
    expect(getResponsesImageResultSource({
      b64_json: 'ZmluYWw=',
      url: 'https://cdn.example/a.png',
    })).toEqual({ kind: 'b64', value: 'ZmluYWw=' })
    expect(getResponsesImageResultSource({
      url: 'https://cdn.example/a.png',
    })).toEqual({ kind: 'url', value: 'https://cdn.example/a.png' })
    expect(getResponsesImageResultSource({
      image_url: 'https://cdn.example/b.png',
    })).toEqual({ kind: 'url', value: 'https://cdn.example/b.png' })
    expect(getResponsesImageResultSource('')).toBeNull()
    expect(getResponsesImageResultSource({ b64_json: '' })).toBeNull()
  })
})

describe('mergeResponsesOutputItem', () => {
  it('keeps an existing image result when the next snapshot is empty', () => {
    expect(mergeResponsesOutputItem(
      { type: 'image_generation_call', id: 'ig_1', result: 'ZmluYWw=', size: '1024x1024' },
      { type: 'image_generation_call', status: 'completed', result: '' },
    )).toEqual({
      type: 'image_generation_call',
      id: 'ig_1',
      result: 'ZmluYWw=',
      size: '1024x1024',
      status: 'completed',
    })
  })
})

describe('resolveResponsesImageResultDataUrl', () => {
  it('downloads HTTP image results as data URLs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }))

    await expect(resolveResponsesImageResultDataUrl(
      { url: 'https://cdn.example/a.png' },
      'image/png',
    )).resolves.toBe('data:image/png;base64,AQID')
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/a.png', expect.objectContaining({ cache: 'no-store' }))
    fetchMock.mockRestore()
  })
})

describe('getImageGenerationItemFromEvent', () => {
  it('rebuilds an image_generation_call item from result + item_id', () => {
    expect(getImageGenerationItemFromEvent({
      type: 'response.image_generation_call.completed',
      item_id: 'ig_1',
      result: 'ZmluYWw=',
    })).toEqual({
      id: 'ig_1',
      type: 'image_generation_call',
      result: 'ZmluYWw=',
    })
  })
})
