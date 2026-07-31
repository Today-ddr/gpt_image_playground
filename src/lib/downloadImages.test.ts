import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureImageCached } from '../store'
import { prepareImageFile, savePreparedImageFile } from './downloadImages'

vi.mock('../store', () => ({
  ensureImageCached: vi.fn(),
}))

function createFile() {
  return new File(['png-image'], 'image.png', { type: 'image/png' })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('prepareImageFile', () => {
  it('resolves an image ID once and preserves the cached data URL MIME', async () => {
    const ensureImageCachedMock = vi.mocked(ensureImageCached)
    ensureImageCachedMock.mockResolvedValue('data:image/jpeg;base64,aW1hZ2UtaWQ=')

    const file = await prepareImageFile('stored-image-id', 'cached/image')

    expect(ensureImageCachedMock).toHaveBeenCalledOnce()
    expect(ensureImageCachedMock).toHaveBeenCalledWith('stored-image-id')
    expect(file.name).toBe('cached-image.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(await file.text()).toBe('image-id')
  })

  it('creates one sanitized File with the Blob MIME extension', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('webp-image', {
      headers: { 'Content-Type': 'image/webp' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const file = await prepareImageFile('https://example.com/image', '  bad:/name  ')

    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('bad-name.webp')
    expect(file.type).toBe('image/webp')
    expect(await file.text()).toBe('webp-image')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('savePreparedImageFile', () => {
  it('starts file sharing synchronously and returns the successful result', async () => {
    const file = createFile()
    const canShare = vi.fn(() => true)
    const share = vi.fn(async () => {})
    const triggerDownload = vi.fn()

    const result = savePreparedImageFile(file, {
      isSecureContext: true,
      navigator: { canShare, share },
      triggerDownload,
    })

    expect(canShare).toHaveBeenCalledWith({ files: [file] })
    expect(share).toHaveBeenCalledWith({ files: [file] })
    expect(triggerDownload).not.toHaveBeenCalled()
    await expect(result).resolves.toBe('shared')
  })

  it('returns cancelled without downloading when sharing raises AbortError', async () => {
    const file = createFile()
    const triggerDownload = vi.fn()

    const result = savePreparedImageFile(file, {
      isSecureContext: true,
      navigator: {
        canShare: vi.fn(() => true),
        share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')),
      },
      triggerDownload,
    })

    await expect(result).resolves.toBe('cancelled')
    expect(triggerDownload).not.toHaveBeenCalled()
  })

  it('downloads the prepared File in a non-secure context', async () => {
    const file = createFile()
    const canShare = vi.fn(() => true)
    const share = vi.fn(async () => {})
    const triggerDownload = vi.fn()

    await expect(savePreparedImageFile(file, {
      isSecureContext: false,
      navigator: { canShare, share },
      triggerDownload,
    })).resolves.toBe('downloaded')

    expect(canShare).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
    expect(triggerDownload).toHaveBeenCalledWith(file, file.name)
  })

  it('downloads the prepared File when file sharing is unsupported', async () => {
    const file = createFile()
    const share = vi.fn(async () => {})
    const triggerDownload = vi.fn()

    await expect(savePreparedImageFile(file, {
      isSecureContext: true,
      navigator: { canShare: vi.fn(() => false), share },
      triggerDownload,
    })).resolves.toBe('downloaded')

    expect(share).not.toHaveBeenCalled()
    expect(triggerDownload).toHaveBeenCalledWith(file, file.name)
  })

  it('downloads the prepared File when canShare throws', async () => {
    const file = createFile()
    const share = vi.fn(async () => {})
    const triggerDownload = vi.fn()

    await expect(savePreparedImageFile(file, {
      isSecureContext: true,
      navigator: {
        canShare: vi.fn(() => {
          throw new Error('canShare failed')
        }),
        share,
      },
      triggerDownload,
    })).resolves.toBe('downloaded')

    expect(share).not.toHaveBeenCalled()
    expect(triggerDownload).toHaveBeenCalledWith(file, file.name)
  })

  it('downloads the prepared File when share fails to start', async () => {
    const file = createFile()
    const triggerDownload = vi.fn()

    await expect(savePreparedImageFile(file, {
      isSecureContext: true,
      navigator: {
        canShare: vi.fn(() => true),
        share: vi.fn((): Promise<void> => {
          throw new Error('share startup failed')
        }),
      },
      triggerDownload,
    })).resolves.toBe('downloaded')

    expect(triggerDownload).toHaveBeenCalledWith(file, file.name)
  })

  it('downloads the prepared File when sharing rejects with a non-Abort error', async () => {
    const file = createFile()
    const triggerDownload = vi.fn()

    await expect(savePreparedImageFile(file, {
      isSecureContext: true,
      navigator: {
        canShare: vi.fn(() => true),
        share: vi.fn().mockRejectedValue(new Error('share failed')),
      },
      triggerDownload,
    })).resolves.toBe('downloaded')

    expect(triggerDownload).toHaveBeenCalledWith(file, file.name)
  })

  it('rejects with the download failure', async () => {
    const failure = new Error('download failed')

    await expect(savePreparedImageFile(createFile(), {
      isSecureContext: false,
      navigator: {},
      triggerDownload: vi.fn(() => {
        throw failure
      }),
    })).rejects.toBe(failure)
  })

  it('does not read the image again when falling back to download', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('png-image', {
      headers: { 'Content-Type': 'image/png' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const file = await prepareImageFile('https://example.com/image', 'image')
    const triggerDownload = vi.fn()

    await savePreparedImageFile(file, {
      isSecureContext: false,
      navigator: {},
      triggerDownload,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(triggerDownload).toHaveBeenCalledWith(file, file.name)
  })
})
