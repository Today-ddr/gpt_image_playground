import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type SyntheticEvent } from 'react'
import type { AfternoonTeaItem, AfternoonTeaTitleRegion } from '../../types'
import {
  getNormalizedPointerDelta,
  moveAfternoonTeaTitleRegion,
  normalizeAfternoonTeaItemTitleRegions,
  getAfternoonTeaPlacementPinCenter,
  resolveAfternoonTeaPlacementSelection,
  readAfternoonTeaPlacementViewMode,
  writeAfternoonTeaPlacementViewMode,
  type AfternoonTeaPlacementViewMode,
} from '../../lib/afternoonTeaTitlePlacement'

export type AfternoonTeaItemPlacementProps = {
  imageSrc: string
  items: AfternoonTeaItem[]
  regions: AfternoonTeaTitleRegion[]
  locked: boolean
  onChange: (regions: AfternoonTeaTitleRegion[]) => void
  selectedIndex?: number | null
  onSelectedIndexChange?: (index: number | null) => void
}

const LABEL_FONT_MIN_PX = 8
const LABEL_FONT_LINE_HEIGHT = 1.1

/** 在 [minPx, maxPx] 上找最大仍 fits 的整数 px；都不 fits 则返回 minPx */
export function fitFontSizePx(opts: {
  minPx: number
  maxPx: number
  fits: (fontSizePx: number) => boolean
}) {
  const minPx = Math.max(1, Math.floor(opts.minPx))
  const maxPx = Math.max(minPx, Math.floor(opts.maxPx))
  if (!opts.fits(minPx)) return minPx
  if (opts.fits(maxPx)) return maxPx
  let low = minPx
  let high = maxPx
  while (low < high) {
    const mid = Math.ceil((low + high + 1) / 2)
    if (opts.fits(mid)) low = mid
    else high = mid - 1
  }
  return low
}

function FitLabelText(props: { text: string }) {
  const boxRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [fontSizePx, setFontSizePx] = useState(LABEL_FONT_MIN_PX)

  useLayoutEffect(() => {
    const el = boxRef.current
    const textEl = textRef.current
    if (!el || !textEl) return
    let cancelled = false

    const recompute = () => {
      if (cancelled || !boxRef.current || !textRef.current) return
      const box = boxRef.current
      const text = textRef.current
      if (box.clientWidth <= 0 || box.clientHeight <= 0) return
      const next = fitFontSizePx({
        minPx: LABEL_FONT_MIN_PX,
        maxPx: Math.max(LABEL_FONT_MIN_PX, Math.floor(box.clientHeight / LABEL_FONT_LINE_HEIGHT)),
        fits: (sizePx) => {
          text.style.fontSize = `${sizePx}px`
          return text.scrollWidth <= box.clientWidth + 1
            && text.scrollHeight <= box.clientHeight + 1
        },
      })
      text.style.fontSize = `${next}px`
      setFontSizePx((prev) => (prev === next ? prev : next))
    }

    const start = () => {
      if (cancelled) return
      recompute()
      if (typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(recompute)
      observer.observe(el)
      return () => observer.disconnect()
    }

    // 字体未就绪时先测一次，就绪后再测避免测偏
    let disposeObserver: (() => void) | undefined
    const fontsReady = document.fonts?.ready
    if (fontsReady) {
      fontsReady.then(() => {
        if (cancelled) return
        recompute()
      })
    }
    disposeObserver = start()

    return () => {
      cancelled = true
      disposeObserver?.()
    }
  }, [props.text])

  return (
    <span
      ref={boxRef}
      data-fit-label
      className="pointer-events-none relative z-[1] flex h-full w-full max-h-full max-w-full items-center justify-center overflow-hidden px-1 sm:px-1.5"
    >
      <span
        ref={textRef}
        className="max-h-full max-w-full break-words text-center font-semibold"
        style={{ fontSize: `${fontSizePx}px`, lineHeight: LABEL_FONT_LINE_HEIGHT }}
      >
        {props.text}
      </span>
    </span>
  )
}

type DragState = {
  index: number
  pointerId: number
  target: HTMLElement
  startPointer: { x: number; y: number }
  startRegions: AfternoonTeaTitleRegion[]
  latestRegions: AfternoonTeaTitleRegion[]
  imageRect: { width: number; height: number }
}

export function AfternoonTeaItemPlacement(props: AfternoonTeaItemPlacementProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [previewRegions, setPreviewRegions] = useState(() => normalizeAfternoonTeaItemTitleRegions(props.regions, props.items.length))
  const [activeIndex, setActiveIndex] = useState<number | null>(() => props.items.length > 0 ? 0 : null)
  const [viewMode, setViewMode] = useState<AfternoonTeaPlacementViewMode>(readAfternoonTeaPlacementViewMode)
  const [loadedImageSize, setLoadedImageSize] = useState<{ src: string; width: number; height: number } | null>(null)
  const imageSize = loadedImageSize?.src === props.imageSrc ? loadedImageSize : null
  const regionsKey = props.regions.map((region) => `${region.x}:${region.y}:${region.width}:${region.height}`).join('|')
  const isSelectionControlled = props.selectedIndex !== undefined
  const resolvedSelectedIndex = resolveAfternoonTeaPlacementSelection(
    isSelectionControlled ? props.selectedIndex : activeIndex,
    props.items.length,
  )
  const selectIndex = (index: number) => {
    if (!isSelectionControlled) setActiveIndex(index)
    props.onSelectedIndexChange?.(index)
  }
  const setPlacementViewMode = (nextMode: AfternoonTeaPlacementViewMode) => {
    if (nextMode === viewMode) return
    setViewMode(nextMode)
    writeAfternoonTeaPlacementViewMode(nextMode)
  }

  useEffect(() => {
    const drag = dragRef.current
    if (props.locked && drag) {
      if (drag.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId)
      dragRef.current = null
    }
    if (!dragRef.current) setPreviewRegions(normalizeAfternoonTeaItemTitleRegions(props.regions, props.items.length))
    if (!isSelectionControlled) {
      setActiveIndex((current) => resolveAfternoonTeaPlacementSelection(current, props.items.length))
    }
  }, [props.items.length, props.locked, regionsKey])

  useEffect(() => {
    dragRef.current = null
  }, [props.imageSrc])

  const updateDrag = (event: PointerEvent<HTMLElement>, drag: DragState) => {
    const delta = getNormalizedPointerDelta(
      drag.startPointer,
      { x: event.clientX, y: event.clientY },
      drag.imageRect,
    )
    const nextRegions = drag.startRegions.map((region, index) => index === drag.index
      ? moveAfternoonTeaTitleRegion(region, delta)
      : region)
    drag.latestRegions = nextRegions
    setPreviewRegions(nextRegions)
  }

  const commitDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!props.locked) updateDrag(event, drag)
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (props.locked) {
      setPreviewRegions(normalizeAfternoonTeaItemTitleRegions(props.regions, props.items.length))
      return
    }
    props.onChange(drag.latestRegions)
  }

  const cancelDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setPreviewRegions(drag.startRegions)
  }

  const handlePointerDown = (index: number, event: PointerEvent<HTMLElement>) => {
    if (props.locked || !event.isPrimary || event.button !== 0) return
    const imageRect = stageRef.current?.getBoundingClientRect()
    if (!imageRect || imageRect.width <= 0 || imageRect.height <= 0 || !imageSize) return
    selectIndex(index)
    const startRegions = normalizeAfternoonTeaItemTitleRegions(previewRegions, props.items.length)
    const target = event.currentTarget
    dragRef.current = {
      index,
      pointerId: event.pointerId,
      target,
      startPointer: { x: event.clientX, y: event.clientY },
      startRegions,
      latestRegions: startRegions,
      imageRect: { width: imageRect.width, height: imageRect.height },
    }
    target.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || props.locked) return
    updateDrag(event, drag)
    event.preventDefault()
  }

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLElement>) => {
    if (props.locked || !imageSize) return
    const step = event.shiftKey ? 0.05 : 0.01
    const delta = {
      x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    }
    if (delta.x === 0 && delta.y === 0) return
    event.preventDefault()
    const nextRegions = previewRegions.map((region, regionIndex) => regionIndex === index
      ? moveAfternoonTeaTitleRegion(region, delta)
      : region)
    setPreviewRegions(nextRegions)
    props.onChange(nextRegions)
  }

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return
    setLoadedImageSize({ src: props.imageSrc, width: image.naturalWidth, height: image.naturalHeight })
  }

  if (!props.imageSrc) {
    return (
      <section className="min-w-0 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]" aria-label="订单商品位置">
        <div className="border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-white/[0.08] dark:text-gray-200">订单商品位置</div>
        <div className="flex aspect-[4/3] items-center justify-center px-4 text-center text-sm text-amber-700 dark:text-amber-300">解析已完成，请粘贴或上传餐品图片</div>
      </section>
    )
  }

  return (
    <section className={`min-w-0 max-w-full rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.03] ${viewMode === 'pin' ? 'overflow-visible' : 'overflow-hidden'}`} aria-label="订单商品位置设置">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
        <span className="hidden min-w-0 text-sm font-medium text-gray-700 sm:inline dark:text-gray-200">订单商品位置</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-gray-400 sm:inline dark:text-gray-500">{props.locked ? '已锁定' : imageSize ? viewMode === 'pin' ? '拖动图钉定位' : '可拖动全部标题框' : '图片加载中'}</span>
          <div role="tablist" aria-label="摆放显示方式" className="inline-flex rounded-md border border-gray-200 bg-gray-100 p-0.5 dark:border-white/[0.1] dark:bg-white/[0.04]">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'pin'}
              onClick={() => setPlacementViewMode('pin')}
              disabled={props.locked || !imageSize}
              className={`min-h-11 rounded px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 sm:min-h-8 sm:px-2.5 ${viewMode === 'pin' ? 'bg-white text-gray-900 shadow-sm dark:bg-white/[0.1] dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}
            >
              图钉
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'boxes'}
              onClick={() => setPlacementViewMode('boxes')}
              disabled={props.locked || !imageSize}
              className={`min-h-11 rounded px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 sm:min-h-8 sm:px-2.5 ${viewMode === 'boxes' ? 'bg-white text-gray-900 shadow-sm dark:bg-white/[0.1] dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}
            >
              全框
            </button>
          </div>
        </div>
      </div>
      <div className={`min-w-0 max-w-full bg-gray-50 dark:bg-black/20 ${viewMode === 'pin' ? 'p-5 sm:p-6' : 'p-1.5 sm:p-2'}`}>
        <div
          ref={stageRef}
          data-title-placement-stage
          aria-label="订单商品标题位置预览"
          aria-busy={!imageSize}
          className={`relative w-full min-w-0 max-w-full bg-gray-100 dark:bg-black/30 ${viewMode === 'pin' ? 'overflow-visible' : 'overflow-hidden'}`}
          style={{ aspectRatio: imageSize ? `${imageSize.width} / ${imageSize.height}` : '4 / 3' }}
        >
          <img
            src={props.imageSrc}
            alt="下午茶餐品原图"
            draggable={false}
            onLoad={handleImageLoad}
            className="absolute inset-0 h-full w-full select-none object-contain"
          />
          {previewRegions.map((region, index) => {
            const item = props.items[index]
            if (!item) return null
            const isSelected = resolvedSelectedIndex === index
            if (viewMode === 'pin') {
              const pin = getAfternoonTeaPlacementPinCenter(region)
              return (
                <button
                  key={index}
                  type="button"
                  data-item-title-box={index}
                  data-item-title-pin={index}
                  data-order-item-index={index}
                  aria-label={`拖动商品 ${item.displayName}`}
                  aria-pressed={isSelected}
                  disabled={props.locked || !imageSize}
                  onPointerDown={(event) => handlePointerDown(index, event)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={commitDrag}
                  onPointerCancel={cancelDrag}
                  onLostPointerCapture={cancelDrag}
                  onKeyDown={(event) => handleKeyDown(index, event)}
                  className={`absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center touch-manipulation ${isSelected ? 'z-20' : 'z-[1]'} ${!imageSize ? 'invisible pointer-events-none' : ''} ${props.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                  style={{
                    left: `${pin.x * 100}%`,
                    top: `${pin.y * 100}%`,
                    touchAction: 'none',
                  }}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-[11px] font-semibold tabular-nums text-white shadow-sm ${isSelected ? 'ring-2 ring-blue-200 ring-offset-1 ring-offset-transparent' : ''}`}>
                    {index + 1}
                  </span>
                </button>
              )
            }
            return (
              <div
                key={index}
                data-item-title-box={index}
                data-order-item-index={index}
                aria-label={`商品 ${item.displayName} 标题位置`}
                aria-disabled={props.locked || !imageSize}
                aria-pressed={isSelected}
                role="button"
                tabIndex={props.locked || !imageSize ? -1 : 0}
                onFocus={() => selectIndex(index)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                className={`absolute overflow-visible ${isSelected ? 'z-10 opacity-100' : 'z-0 opacity-50 sm:opacity-100'} ${!imageSize ? 'invisible pointer-events-none' : ''}`}
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                  touchAction: 'none',
                }}
              >
                <div
                  onPointerDown={(event) => handlePointerDown(index, event)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={commitDrag}
                  onPointerCancel={cancelDrag}
                  onLostPointerCapture={cancelDrag}
                  className={`flex h-full w-full select-none items-center justify-center overflow-visible rounded border-2 border-dashed text-center font-semibold shadow-sm backdrop-blur-[1px] ${props.locked ? 'cursor-not-allowed border-white/60 bg-black/35 text-white/90' : 'cursor-grab border-white bg-blue-600/70 text-white ring-1 ring-blue-700/40 active:cursor-grabbing'}`}
                  style={{ touchAction: 'none' }}
                >
                  <FitLabelText text={item.displayName} />
                </div>
                {!props.locked && imageSize && (
                  <div
                    data-title-placement-hit-area
                    aria-hidden="true"
                    onPointerDown={(event) => handlePointerDown(index, event)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={commitDrag}
                    onPointerCancel={cancelDrag}
                    onLostPointerCapture={cancelDrag}
                    className="pointer-events-auto absolute left-1/2 top-1/2 z-20 h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-manipulation"
                    style={{ touchAction: 'none' }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// 保留旧导出名，避免外部历史导入在迁移期间直接崩溃；新页面不再使用它。
export const AfternoonTeaTitlePlacement = AfternoonTeaItemPlacement
