import { afterEach, describe, expect, it, vi } from 'vitest'
import { canCopyImageToClipboard, copyImageSourceToClipboard, getClipboardFailureMessage } from './clipboard'

class FakeClipboardItem {
  static supports?: (type: string) => boolean
  constructor(public data: Record<string, Blob | Promise<Blob>>) {}
}

function stubImageClipboard(write = vi.fn().mockResolvedValue(undefined)) {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('ClipboardItem', FakeClipboardItem)
  vi.stubGlobal('navigator', { clipboard: { write } })
  return write
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (FakeClipboardItem as { supports?: (type: string) => boolean }).supports
})

describe('canCopyImageToClipboard', () => {
  it('requires a secure context, clipboard.write, and ClipboardItem', () => {
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } })
    expect(canCopyImageToClipboard()).toBe(false)

    stubImageClipboard()
    expect(canCopyImageToClipboard()).toBe(true)
  })
})

describe('copyImageSourceToClipboard', () => {
  it('writes a png blob as image/png and does not add html or files', async () => {
    const pngBlob = new Blob(['png-bytes'], { type: 'image/png' })
    const write = stubImageClipboard()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: async () => pngBlob,
    }))

    await copyImageSourceToClipboard('blob:poster')

    expect(write).toHaveBeenCalledOnce()
    const item = write.mock.calls[0][0][0] as FakeClipboardItem
    expect(item).toBeInstanceOf(FakeClipboardItem)
    expect(Object.keys(item.data)).toEqual(['image/png'])
    expect(item.data['image/png']).toBe(pngBlob)
  })

  it('rejects when the image source is missing', async () => {
    stubImageClipboard()
    await expect(copyImageSourceToClipboard(Promise.resolve(undefined)))
      .rejects.toThrow('Image source is not available')
  })

  it('rejects when the clipboard image API is unavailable', async () => {
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('navigator', { clipboard: {} })
    await expect(copyImageSourceToClipboard('blob:poster'))
      .rejects.toThrow('Clipboard image API is not available')
  })
})

describe('getClipboardFailureMessage', () => {
  it('keeps the fallback for ordinary failures', () => {
    expect(getClipboardFailureMessage('复制失败，请改用保存', new Error('boom')))
      .toBe('复制失败，请改用保存')
  })
})
