import { describe, expect, it } from 'vitest'
import type { AfternoonTeaTitleRegion } from '../types'
import {
  DEFAULT_AFTERNOON_TEA_TITLE_REGION,
  clampAfternoonTeaTitleRegion,
  getAfternoonTeaTitlePlacement,
  getAfternoonTeaPlacementPinCenter,
  getNormalizedPointerDelta,
  moveAfternoonTeaTitleRegion,
  normalizeAfternoonTeaTitleRegion,
  resolveAfternoonTeaPlacementSelection,
  resolveAfternoonTeaTitleRegionForImage,
  resolveAfternoonTeaPlacementViewMode,
  readAfternoonTeaPlacementViewMode,
  writeAfternoonTeaPlacementViewMode,
  AFTERNOON_TEA_PLACEMENT_VIEW_MODE_STORAGE_KEY,
} from './afternoonTeaTitlePlacement'

describe('afternoon tea title placement', () => {
  it('uses the shared default region for new or missing values', () => {
    expect(DEFAULT_AFTERNOON_TEA_TITLE_REGION).toEqual({
      x: 0.29,
      y: 0.06,
      width: 0.42,
      height: 0.16,
    })
    expect(normalizeAfternoonTeaTitleRegion(undefined)).toEqual(DEFAULT_AFTERNOON_TEA_TITLE_REGION)
    expect(normalizeAfternoonTeaTitleRegion(null)).toEqual(DEFAULT_AFTERNOON_TEA_TITLE_REGION)
  })

  it.each([
    [{ x: '0.2', y: 0.1, width: 0.4, height: 0.2 }, 'string'],
    [{ x: Number.NaN, y: 0.1, width: 0.4, height: 0.2 }, 'NaN'],
    [{ x: Number.POSITIVE_INFINITY, y: 0.1, width: 0.4, height: 0.2 }, 'Infinity'],
    [{ x: -0.3, y: 0.1, width: 0.4, height: 0.2 }, 'pin overflow left'],
    [{ x: 0.1, y: 0.1, width: 1.1, height: 0.2 }, 'width overflow'],
    [{ x: 0.9, y: 0.1, width: 0.4, height: 0.2 }, 'pin overflow right'],
    [{ x: 0.1, y: 0.9, width: 0.2, height: 0.4 }, 'pin overflow bottom'],
  ])('falls back to the default region for %s values', (value, _label) => {
    expect(normalizeAfternoonTeaTitleRegion(value)).toEqual(DEFAULT_AFTERNOON_TEA_TITLE_REGION)
  })

  it('keeps a pin-centered box whose rectangle hangs off the image edge', () => {
    const overflowing = { x: -0.1, y: 0.1, width: 0.4, height: 0.2 }
    expect(normalizeAfternoonTeaTitleRegion(overflowing)).toEqual(overflowing)
  })

  it('clamps a moved region by the pin center so the pin can reach the image edge', () => {
    const region: AfternoonTeaTitleRegion = { x: 0.72, y: 0.75, width: 0.28, height: 0.25 }

    expect(clampAfternoonTeaTitleRegion({ ...region, x: 0.9, y: 0.9 })).toEqual({
      x: 0.86,
      y: 0.875,
      width: 0.28,
      height: 0.25,
    })
    expect(moveAfternoonTeaTitleRegion(region, { x: 0.4, y: 0.4 })).toEqual({
      x: 0.86,
      y: 0.875,
      width: 0.28,
      height: 0.25,
    })
    expect(getAfternoonTeaPlacementPinCenter(moveAfternoonTeaTitleRegion(region, { x: 0.4, y: 0.4 })))
      .toEqual({ x: 1, y: 1 })
    expect(moveAfternoonTeaTitleRegion(region, { x: -1, y: -1 })).toEqual({
      x: -0.14,
      y: -0.125,
      width: 0.28,
      height: 0.25,
    })
    expect(getAfternoonTeaPlacementPinCenter(moveAfternoonTeaTitleRegion(region, { x: -1, y: -1 })))
      .toEqual({ x: 0, y: 0 })
  })

  it('keeps legal positive dimensions and clamps an otherwise overflowing rectangle', () => {
    const tiny = { x: 0.999, y: 0.999, width: 0.0004, height: 0.0004 }

    expect(clampAfternoonTeaTitleRegion(tiny)).toEqual(tiny)
    expect(moveAfternoonTeaTitleRegion({ x: 0.9, y: 0.9, width: 0.2, height: 0.2 }, { x: 0, y: 0 }))
      .toEqual({ x: 0.9, y: 0.9, width: 0.2, height: 0.2 })
  })

  it('converts pointer movement using the actual rendered image rectangle', () => {
    expect(getNormalizedPointerDelta(
      { x: 100, y: 50 },
      { x: 500, y: 250 },
      { width: 800, height: 400 },
    )).toEqual({ x: 0.5, y: 0.5 })
  })

  it('keeps dragged pin coordinates to three decimals without leaving the image', () => {
    expect(moveAfternoonTeaTitleRegion(
      { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
      { x: 0.123456, y: 0.234567 },
    )).toEqual({ x: 0.223, y: 0.435, width: 0.3, height: 0.2 })
    expect(moveAfternoonTeaTitleRegion(
      { x: 0.6, y: 0.6, width: 0.3334, height: 0.3334 },
      { x: 0.2, y: 0.2 },
    )).toEqual({ x: 0.8, y: 0.8, width: 0.3334, height: 0.3334 })
    expect(moveAfternoonTeaTitleRegion(
      { x: 0.6, y: 0.6, width: 0.3334, height: 0.3334 },
      { x: 0.3, y: 0.3 },
    )).toEqual({ x: 0.833, y: 0.833, width: 0.3334, height: 0.3334 })
    expect(getAfternoonTeaPlacementPinCenter({ x: 0.833, y: 0.833, width: 0.3334, height: 0.3334 }))
      .toEqual({ x: 1, y: 1 })
  })

  it('preserves the region for the same image and resets it for a different image', () => {
    const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.2 }

    expect(resolveAfternoonTeaTitleRegionForImage('image-a', 'image-a', region)).toEqual(region)
    expect(resolveAfternoonTeaTitleRegionForImage('image-a', 'image-b', region))
      .toEqual(DEFAULT_AFTERNOON_TEA_TITLE_REGION)
    expect(resolveAfternoonTeaTitleRegionForImage('image-a', null, region))
      .toEqual(DEFAULT_AFTERNOON_TEA_TITLE_REGION)
    expect(resolveAfternoonTeaTitleRegionForImage(null, null, region))
      .toEqual(DEFAULT_AFTERNOON_TEA_TITLE_REGION)
  })

  it('returns the default placement for an invalid region instead of partially clamping it', () => {
    expect(getAfternoonTeaTitlePlacement({ x: Number.NaN, y: 0.2, width: 0.3, height: 0.2 }))
      .toEqual(getAfternoonTeaTitlePlacement(DEFAULT_AFTERNOON_TEA_TITLE_REGION))
  })

  it('maps title centers to the nine semantic regions', () => {
    const cases: Array<[number, number, string]> = [
      [0.05, 0.05, '上方偏左'],
      [0.45, 0.05, '上方居中'],
      [0.85, 0.05, '上方偏右'],
      [0.05, 0.45, '中部偏左'],
      [0.45, 0.45, '画面中央'],
      [0.85, 0.45, '中部偏右'],
      [0.05, 0.85, '下方偏左'],
      [0.45, 0.85, '下方居中'],
      [0.85, 0.85, '下方偏右'],
    ]

    for (const [x, y, semanticRegion] of cases) {
      expect(getAfternoonTeaTitlePlacement({ x, y, width: 0.1, height: 0.1 }).semanticRegion)
        .toBe(semanticRegion)
    }
  })

  it('converts the normalized rectangle to integer percentages', () => {
    expect(getAfternoonTeaTitlePlacement(DEFAULT_AFTERNOON_TEA_TITLE_REGION)).toEqual({
      semanticRegion: '上方居中',
      boxPercent: { left: 29, top: 6, right: 71, bottom: 22 },
    })
  })

  it('clips overflowing box percents while keeping the pin at the image edge', () => {
    const region = { x: -0.21, y: -0.08, width: 0.42, height: 0.16 }
    expect(getAfternoonTeaPlacementPinCenter(region)).toEqual({ x: 0, y: 0 })
    expect(getAfternoonTeaTitlePlacement(region)).toEqual({
      semanticRegion: '上方偏左',
      boxPercent: { left: 0, top: 0, right: 21, bottom: 8 },
    })
  })

  it('keeps an explicit empty selection and only repairs out-of-range indexes', () => {
    expect(resolveAfternoonTeaPlacementSelection(null, 8)).toBeNull()
    expect(resolveAfternoonTeaPlacementSelection(3, 8)).toBe(3)
    expect(resolveAfternoonTeaPlacementSelection(8, 8)).toBe(0)
    expect(resolveAfternoonTeaPlacementSelection(1, 0)).toBeNull()
  })

  it('places an unselected pin at the title box center', () => {
    expect(getAfternoonTeaPlacementPinCenter({ x: 0.1, y: 0.2, width: 0.3, height: 0.2 }))
      .toEqual({ x: 0.25, y: 0.3 })
  })

  it('persists only pin or boxes placement view modes', () => {
    const storage = new Map<string, string>()
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    }

    expect(resolveAfternoonTeaPlacementViewMode('boxes')).toBe('boxes')
    expect(resolveAfternoonTeaPlacementViewMode('other')).toBe('pin')
    expect(readAfternoonTeaPlacementViewMode(fakeStorage)).toBe('pin')
    writeAfternoonTeaPlacementViewMode('boxes', fakeStorage)
    expect(storage.get(AFTERNOON_TEA_PLACEMENT_VIEW_MODE_STORAGE_KEY)).toBe('boxes')
    expect(readAfternoonTeaPlacementViewMode(fakeStorage)).toBe('boxes')
  })
})
