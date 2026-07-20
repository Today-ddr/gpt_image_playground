import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatStorageBytes, getBrowserStorageUsage, getStorageUsagePercentage } from './browserStorage'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('browser storage helpers', () => {
  describe('formatStorageBytes', () => {
    it.each([
      [0, '0 B'],
      [512, '512 B'],
      [1536, '1.5 KB'],
      [15 * 1024 ** 2, '15 MB'],
      [2 * 1024 ** 3, '2 GB'],
    ])('formats %i bytes as %s', (bytes, expected) => {
      expect(formatStorageBytes(bytes)).toBe(expected)
    })
  })

  describe('getStorageUsagePercentage', () => {
    it('calculates the usage percentage', () => {
      expect(getStorageUsagePercentage(25, 100)).toBe(25)
    })

    it('limits the usage percentage to 100', () => {
      expect(getStorageUsagePercentage(120, 100)).toBe(100)
    })

    it('limits the usage percentage to 0', () => {
      expect(getStorageUsagePercentage(-25, 100)).toBe(0)
    })

    it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'returns null when quota is unavailable or invalid: %s',
      (quota) => {
        expect(getStorageUsagePercentage(25, quota)).toBeNull()
      },
    )
  })

  describe('getBrowserStorageUsage', () => {
    it('returns null when the storage estimate API is unavailable', async () => {
      vi.stubGlobal('navigator', {})

      await expect(getBrowserStorageUsage()).resolves.toBeNull()
    })

    it('accepts zero as a valid usage value', async () => {
      vi.stubGlobal('navigator', {
        storage: {
          estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 100 }),
        },
      })

      await expect(getBrowserStorageUsage()).resolves.toEqual({
        usage: 0,
        quota: 100,
        percentage: 0,
      })
    })

    it('returns the usage percentage when quota is valid', async () => {
      vi.stubGlobal('navigator', {
        storage: {
          estimate: vi.fn().mockResolvedValue({ usage: 25, quota: 100 }),
        },
      })

      await expect(getBrowserStorageUsage()).resolves.toEqual({
        usage: 25,
        quota: 100,
        percentage: 25,
      })
    })

    it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'keeps usage when quota is unavailable or invalid: %s',
      async (quota) => {
        vi.stubGlobal('navigator', {
          storage: {
            estimate: vi.fn().mockResolvedValue({ usage: 25, quota }),
          },
        })

        await expect(getBrowserStorageUsage()).resolves.toEqual({
          usage: 25,
          quota: null,
          percentage: null,
        })
      },
    )

    it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'returns null when usage is unavailable or invalid: %s',
      async (usage) => {
        vi.stubGlobal('navigator', {
          storage: {
            estimate: vi.fn().mockResolvedValue({ usage, quota: 100 }),
          },
        })

        await expect(getBrowserStorageUsage()).resolves.toBeNull()
      },
    )

    it('returns null and warns when estimating storage fails', async () => {
      const err = new Error('estimate failed')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('navigator', {
        storage: {
          estimate: vi.fn().mockRejectedValue(err),
        },
      })

      await expect(getBrowserStorageUsage()).resolves.toBeNull()
      expect(warn).toHaveBeenCalledWith('读取浏览器存储占用失败', err)
    })
  })
})
