import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AFTERNOON_TEA_TITLE_REGION,
  createDefaultAfternoonTeaItemTitleRegions,
  getAfternoonTeaPlacementPinCenter,
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
      { x: 0.9, y: 0.2, width: 0.4, height: 0.2 },
    ], 4)

    expect(regions).toHaveLength(4)
    expect(regions[0]).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.2 })
    expect(regions[1]).toEqual(createDefaultAfternoonTeaItemTitleRegions(4)[1])
    expect(regions[2]).toEqual(createDefaultAfternoonTeaItemTitleRegions(4)[2])
    expect(regions[3]).toEqual(createDefaultAfternoonTeaItemTitleRegions(4)[3])
    expect(regions.every((region) => {
      const pinX = region.x + region.width / 2
      const pinY = region.y + region.height / 2
      return pinX >= 0 && pinY >= 0 && pinX <= 1 && pinY <= 1
    })).toBe(true)
  })

  it('lines pins across a wide table and uses a Z on a squarer photo', () => {
    const widePins = createDefaultAfternoonTeaItemTitleRegions(4, 3).map(getAfternoonTeaPlacementPinCenter)
    const squarePins = createDefaultAfternoonTeaItemTitleRegions(4, 1376 / 1170).map(getAfternoonTeaPlacementPinCenter)

    expect(widePins).toEqual([
      { x: 0.186, y: 0.5 },
      { x: 0.395, y: 0.5 },
      { x: 0.606, y: 0.5 },
      { x: 0.815, y: 0.5 },
    ])
    expect(squarePins).toEqual([
      { x: 0.32, y: 0.36 },
      { x: 0.68, y: 0.36 },
      { x: 0.32, y: 0.64 },
      { x: 0.68, y: 0.64 },
    ])
    expect(createDefaultAfternoonTeaItemTitleRegions(3, 2.4).map(getAfternoonTeaPlacementPinCenter)).toEqual([
      { x: 0.221, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.781, y: 0.5 },
    ])
  })

  it('preserves positions for the same image and resets them for a new image', () => {
    const current = [{ x: 0.1, y: 0.2, width: 0.3, height: 0.2 }]

    expect(resolveAfternoonTeaItemTitleRegionsForImage('image-a', 'image-a', current, 1)).toEqual(current)
    expect(resolveAfternoonTeaItemTitleRegionsForImage('image-a', 'image-b', current, 2))
      .toEqual(createDefaultAfternoonTeaItemTitleRegions(2))
  })
})
