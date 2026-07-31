import type { AfternoonTeaTitleRegion } from '../types'

export const DEFAULT_AFTERNOON_TEA_TITLE_REGION: AfternoonTeaTitleRegion = {
  x: 0.29,
  y: 0.06,
  width: 0.42,
  height: 0.16,
}

export interface AfternoonTeaTitlePlacement {
  semanticRegion: string
  boxPercent: {
    left: number
    top: number
    right: number
    bottom: number
  }
}

type PointerPoint = { x: number; y: number }
type ImageRectSize = { width: number; height: number }

function copyDefaultRegion() {
  return { ...DEFAULT_AFTERNOON_TEA_TITLE_REGION }
}

function roundRegionValue(value: number) {
  return Math.round(value * 1000) / 1000
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidRegion(value: AfternoonTeaTitleRegion) {
  return isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height)
    && value.x >= 0
    && value.y >= 0
    && value.width > 0
    && value.height > 0
    && value.x <= 1
    && value.y <= 1
    && value.width <= 1
    && value.height <= 1
    && value.x + value.width <= 1
    && value.y + value.height <= 1
}

function readValidRegion(value: unknown): AfternoonTeaTitleRegion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<AfternoonTeaTitleRegion>
  const region = {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  }
  return isValidRegion(region as AfternoonTeaTitleRegion)
    ? { ...region as AfternoonTeaTitleRegion }
    : null
}

export function normalizeAfternoonTeaTitleRegion(value: unknown): AfternoonTeaTitleRegion {
  return readValidRegion(value) ?? copyDefaultRegion()
}

export function createDefaultAfternoonTeaItemTitleRegions(count: number): AfternoonTeaTitleRegion[] {
  const itemCount = isFiniteNumber(count) ? Math.max(0, Math.floor(count)) : 0
  const maxX = 1 - DEFAULT_AFTERNOON_TEA_TITLE_REGION.width
  const maxY = 1 - DEFAULT_AFTERNOON_TEA_TITLE_REGION.height
  return Array.from({ length: itemCount }, (_, index) => ({
    ...DEFAULT_AFTERNOON_TEA_TITLE_REGION,
    x: roundRegionValue((DEFAULT_AFTERNOON_TEA_TITLE_REGION.x + index * 0.191) % maxX),
    y: roundRegionValue((DEFAULT_AFTERNOON_TEA_TITLE_REGION.y + index * 0.227) % maxY),
  }))
}

export function normalizeAfternoonTeaItemTitleRegions(value: unknown, count: number): AfternoonTeaTitleRegion[] {
  const defaults = createDefaultAfternoonTeaItemTitleRegions(count)
  if (!Array.isArray(value)) return defaults
  return defaults.map((fallback, index) => readValidRegion(value[index]) ?? fallback)
}

export function clampAfternoonTeaTitleRegion(region: AfternoonTeaTitleRegion): AfternoonTeaTitleRegion {
  const width = isFiniteNumber(region.width) && region.width > 0 && region.width <= 1
    ? region.width
    : DEFAULT_AFTERNOON_TEA_TITLE_REGION.width
  const height = isFiniteNumber(region.height) && region.height > 0 && region.height <= 1
    ? region.height
    : DEFAULT_AFTERNOON_TEA_TITLE_REGION.height
  const x = isFiniteNumber(region.x) ? region.x : DEFAULT_AFTERNOON_TEA_TITLE_REGION.x
  const y = isFiniteNumber(region.y) ? region.y : DEFAULT_AFTERNOON_TEA_TITLE_REGION.y
  return {
    x: Math.min(Math.max(x, 0), 1 - width),
    y: Math.min(Math.max(y, 0), 1 - height),
    width,
    height,
  }
}

export function moveAfternoonTeaTitleRegion(
  region: AfternoonTeaTitleRegion,
  delta: PointerPoint,
): AfternoonTeaTitleRegion {
  const x = isFiniteNumber(region.x) ? region.x : DEFAULT_AFTERNOON_TEA_TITLE_REGION.x
  const y = isFiniteNumber(region.y) ? region.y : DEFAULT_AFTERNOON_TEA_TITLE_REGION.y
  const clamped = clampAfternoonTeaTitleRegion({
    ...region,
    x: x + (isFiniteNumber(delta.x) ? delta.x : 0),
    y: y + (isFiniteNumber(delta.y) ? delta.y : 0),
  })
  const maxX = Math.max(0, Math.floor((1 - clamped.width) * 1000) / 1000)
  const maxY = Math.max(0, Math.floor((1 - clamped.height) * 1000) / 1000)
  return {
    ...clamped,
    x: Math.min(Math.round(clamped.x * 1000) / 1000, maxX),
    y: Math.min(Math.round(clamped.y * 1000) / 1000, maxY),
  }
}

export function resolveAfternoonTeaItemTitleRegionsForImage(
  currentImageId: string | null,
  nextImageId: string | null,
  currentRegions: unknown,
  itemCount: number,
): AfternoonTeaTitleRegion[] {
  if (currentImageId && nextImageId && currentImageId === nextImageId) {
    return normalizeAfternoonTeaItemTitleRegions(currentRegions, itemCount)
  }
  return createDefaultAfternoonTeaItemTitleRegions(itemCount)
}

export function getNormalizedPointerDelta(
  start: PointerPoint,
  current: PointerPoint,
  imageRect: ImageRectSize,
): PointerPoint {
  if (!isFiniteNumber(imageRect.width) || !isFiniteNumber(imageRect.height) || imageRect.width <= 0 || imageRect.height <= 0) {
    return { x: 0, y: 0 }
  }
  return {
    x: (current.x - start.x) / imageRect.width,
    y: (current.y - start.y) / imageRect.height,
  }
}

export function resolveAfternoonTeaTitleRegionForImage(
  currentImageId: string | null,
  nextImageId: string | null,
  currentRegion: unknown,
): AfternoonTeaTitleRegion {
  if (currentImageId && nextImageId && currentImageId === nextImageId) {
    return normalizeAfternoonTeaTitleRegion(currentRegion)
  }
  return copyDefaultRegion()
}

export function getAfternoonTeaTitlePlacement(region: AfternoonTeaTitleRegion): AfternoonTeaTitlePlacement {
  const normalized = clampAfternoonTeaTitleRegion(normalizeAfternoonTeaTitleRegion(region))
  const centerX = normalized.x + normalized.width / 2
  const centerY = normalized.y + normalized.height / 2
  const column = Math.min(2, Math.floor(centerX * 3))
  const row = Math.min(2, Math.floor(centerY * 3))
  const labels = [
    ['上方偏左', '上方居中', '上方偏右'],
    ['中部偏左', '画面中央', '中部偏右'],
    ['下方偏左', '下方居中', '下方偏右'],
  ]
  return {
    semanticRegion: labels[row][column],
    boxPercent: {
      left: Math.round(normalized.x * 100),
      top: Math.round(normalized.y * 100),
      right: Math.round((normalized.x + normalized.width) * 100),
      bottom: Math.round((normalized.y + normalized.height) * 100),
    },
  }
}
