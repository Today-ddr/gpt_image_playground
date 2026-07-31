import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AFTERNOON_TEA_TITLE_REGION,
  createDefaultAfternoonTeaItemTitleRegions,
  normalizeAfternoonTeaItemTitleRegions,
  resolveAfternoonTeaItemTitleRegionsForImage,
} from './afternoonTeaTitlePlacement'

describe('afternoon tea item title placement', () => {
  it('creates one distinct default region for every order item', () => {
    const regions = createDefaultAfternoonTeaItemTitleRegions(4)

    expect(regions).toHaveLength(4)
    expect(regions[0]).toEqual(DEFAULT_AFTERNOON_TEA_TITLE_REGION)
    expect(new Set(regions.map((region) => `${region.x}:${region.y}`)).size).toBeGreaterThan(1)
  })

  it('normalizes missing and invalid entries to bounded defaults for the item count', () => {
    const regions = normalizeAfternoonTeaItemTitleRegions([
      { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
      { x: Number.NaN, y: 0.2, width: 0.3, height: 0.2 },
      { x: 0.8, y: 0.2, width: 0.4, height: 0.2 },
    ], 4)

    expect(regions).toHaveLength(4)
    expect(regions[0]).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.2 })
    expect(regions[1]).toEqual(createDefaultAfternoonTeaItemTitleRegions(4)[1])
    expect(regions[2]).toEqual(createDefaultAfternoonTeaItemTitleRegions(4)[2])
    expect(regions[3]).toEqual(createDefaultAfternoonTeaItemTitleRegions(4)[3])
    expect(regions.every((region) => region.x >= 0 && region.y >= 0 && region.x + region.width <= 1 && region.y + region.height <= 1)).toBe(true)
  })

  it('preserves positions for the same image and resets them for a new image', () => {
    const current = [{ x: 0.1, y: 0.2, width: 0.3, height: 0.2 }]

    expect(resolveAfternoonTeaItemTitleRegionsForImage('image-a', 'image-a', current, 1)).toEqual(current)
    expect(resolveAfternoonTeaItemTitleRegionsForImage('image-a', 'image-b', current, 2))
      .toEqual(createDefaultAfternoonTeaItemTitleRegions(2))
  })
})
