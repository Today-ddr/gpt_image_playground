import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AfternoonTeaItem, AfternoonTeaTitleRegion } from '../../types'
import { AfternoonTeaItemPlacement, fitFontSizePx } from './AfternoonTeaTitlePlacement'
import placementSource from './AfternoonTeaTitlePlacement.tsx?raw'
import { AFTERNOON_TEA_PLACEMENT_VIEW_MODE_STORAGE_KEY } from '../../lib/afternoonTeaTitlePlacement'

const items: AfternoonTeaItem[] = [
  { displayName: '蟹肉沙拉紫菜包饭', tags: [] },
  { displayName: '金枪鱼紫菜包饭', tags: [] },
  { displayName: '蛋黄肉松紫菜包饭', tags: [] },
]

const regions: AfternoonTeaTitleRegion[] = [
  { x: 0.05, y: 0.05, width: 0.3, height: 0.16 },
  { x: 0.35, y: 0.05, width: 0.3, height: 0.16 },
  { x: 0.05, y: 0.25, width: 0.3, height: 0.16 },
]

const memoryStorage = new Map<string, string>()
const fakeStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { memoryStorage.set(key, value) },
  removeItem: (key: string) => { memoryStorage.delete(key) },
}

afterEach(() => {
  memoryStorage.clear()
  vi.unstubAllGlobals()
})

function renderBoxes(node: Parameters<typeof renderToStaticMarkup>[0]) {
  memoryStorage.set(AFTERNOON_TEA_PLACEMENT_VIEW_MODE_STORAGE_KEY, 'boxes')
  vi.stubGlobal('window', { localStorage: fakeStorage })
  return renderToStaticMarkup(node)
}

describe('AfternoonTeaItemPlacement', () => {
  it('renders one draggable label for every order item, using displayName', () => {
    const html = renderToStaticMarkup(<AfternoonTeaItemPlacement
      imageSrc="data:image/png;base64,AQID"
      items={items}
      regions={regions}
      locked={false}
      onChange={() => {}}
    />)

    expect((html.match(/data-item-title-box=/g) ?? [])).toHaveLength(items.length)
    expect((html.match(/data-item-title-pin=/g) ?? [])).toHaveLength(items.length)
    expect(html).toContain('蟹肉沙拉紫菜包饭')
    expect(html).toContain('金枪鱼紫菜包饭')
    expect(html).toContain('蛋黄肉松紫菜包饭')
    expect(html).toContain('touch-action:none')
    expect(html).not.toContain('data-fit-label')
  })

  it('keeps the visible frame equal to the percent rectangle without enabling every expanded hit area', () => {
    const html = renderBoxes(<AfternoonTeaItemPlacement
      imageSrc="data:image/png;base64,AQID"
      items={items}
      regions={regions}
      locked={false}
      onChange={() => {}}
    />)

    const firstBox = html.match(/<div data-item-title-box="0"[^>]*>/)?.[0] ?? ''
    expect(firstBox).toContain('width:30%')
    expect(firstBox).toContain('height:16%')
    expect(firstBox).not.toContain('min-h-11')
    expect(firstBox).not.toContain('min-w-[44px]')
    expect(html).not.toContain('data-title-placement-hit-area')
    expect(placementSource).toContain('resolvedSelectedIndex === index')
    expect(placementSource).toContain('onFocus={() => selectIndex(index)}')
    expect(placementSource).toContain('selectIndex(index)')
    expect(placementSource).toContain('h-11 w-11')
  })

  it('uses compact wrapping text inside narrow mobile title boxes', () => {
    const html = renderBoxes(<AfternoonTeaItemPlacement
      imageSrc="data:image/png;base64,AQID"
      items={[{ displayName: '蟹肉沙拉紫菜包饭', tags: [] }]}
      regions={[regions[0]]}
      locked={false}
      onChange={() => {}}
    />)

    expect(html).toContain('data-fit-label')
    expect(html).toContain('pointer-events-none')
    expect(html).toContain('break-words')
    expect(html).toContain('items-center')
    expect(html).toContain('justify-center')
    expect(html).toContain('font-size:8px')
    expect(html).toContain('line-height:1.1')
    expect(html).toContain('p-1.5')
    expect(html).toContain('sm:p-2')
    expect(placementSource).toContain('fitFontSizePx')
    expect(placementSource).toContain('LABEL_FONT_MIN_PX')
    expect(placementSource).toContain('LABEL_FONT_LINE_HEIGHT')
    expect(placementSource).toContain("typeof ResizeObserver === 'undefined'")
    expect(placementSource).not.toContain('text-[10px]')
    expect(placementSource).not.toContain('sm:text-sm')
  })

  it('does not render a mobile product selector and keeps canvas-based activation', () => {
    const html = renderToStaticMarkup(<AfternoonTeaItemPlacement
      imageSrc="data:image/png;base64,AQID"
      items={items}
      regions={regions}
      locked={false}
      onChange={() => {}}
    />)

    expect(html).not.toContain('选择要定位的订单商品')
    expect(html).not.toContain('当前商品')
    expect(html).not.toContain('<select')
    expect(placementSource).not.toContain('setActiveIndex(Number(event.target.value))')
    expect(placementSource).toContain('setActiveIndex(index)')
    expect(placementSource).toContain('onFocus={() => selectIndex(index)}')
  })

  it('picks the largest fitting font size within min and max bounds', () => {
    expect(fitFontSizePx({
      minPx: 8,
      maxPx: 14,
      fits: () => true,
    })).toBe(14)
    expect(fitFontSizePx({
      minPx: 8,
      maxPx: 14,
      fits: () => false,
    })).toBe(8)
    expect(fitFontSizePx({
      minPx: 8,
      maxPx: 14,
      fits: (sizePx) => sizePx <= 11,
    })).toBe(11)
  })

  it('uses the current label height as the font search ceiling instead of a fixed cap', () => {
    const fitLabelStart = placementSource.indexOf('function FitLabelText')
    const fitLabelEnd = placementSource.indexOf('type DragState', fitLabelStart)
    const fitLabelSource = placementSource.slice(fitLabelStart, fitLabelEnd)

    expect(fitLabelStart).toBeGreaterThan(-1)
    expect(fitLabelSource).toContain('Math.floor(box.clientHeight / LABEL_FONT_LINE_HEIGHT)')
    expect(fitLabelSource).not.toContain('LABEL_FONT_MAX_PX')
    expect(fitFontSizePx({
      minPx: 8,
      maxPx: 109,
      fits: (sizePx) => sizePx <= 72,
    })).toBe(72)
  })

  it('keeps every pin as a numbered marker and highlights the selected one', () => {
    const html = renderToStaticMarkup(<AfternoonTeaItemPlacement
      imageSrc="data:image/png;base64,AQID"
      items={items}
      regions={regions}
      locked={false}
      onChange={() => {}}
    />)
    const firstPin = html.match(/<button[^>]*data-item-title-box="0"[^>]*>/)?.[0] ?? ''
    const secondPin = html.match(/<button[^>]*data-item-title-box="1"[^>]*>/)?.[0] ?? ''

    expect(firstPin).toContain('aria-pressed="true"')
    expect(firstPin).toContain('data-item-title-pin="0"')
    expect(secondPin).toContain('aria-pressed="false"')
    expect(secondPin).toContain('data-item-title-pin="1"')
    expect(placementSource).toContain('拖动图钉定位')
    expect(placementSource).toContain('role="tablist"')
    expect(html).toContain('aria-label="摆放显示方式"')
    expect(html).toContain('>图钉<')
    expect(html).toContain('>全框<')
    expect(html).toContain('aria-label="拖动商品 金枪鱼紫菜包饭"')
    expect((html.match(/data-item-title-pin=/g) ?? [])).toHaveLength(items.length)
    expect(html).not.toContain('aria-label="商品 蟹肉沙拉紫菜包饭 标题位置"')
    expect(placementSource).toContain('hidden min-w-0 text-sm font-medium text-gray-700 sm:inline')
    expect(placementSource).toContain('hidden text-xs text-gray-400 sm:inline')
    expect(placementSource).toContain("viewMode === 'pin' ? 'overflow-visible' : 'overflow-hidden'")
    expect(placementSource).toContain("viewMode === 'pin' ? 'p-5 sm:p-6' : 'p-1.5 sm:p-2'")
  })

  it('lets pins start a drag without expanding into a title box', () => {
    expect(placementSource).toContain("if (viewMode === 'pin')")
    expect(placementSource).not.toContain('selectOnStart')
    expect(placementSource).not.toContain('selectOnRelease')
    expect(placementSource).toContain("setPlacementViewMode('pin')")
    expect(placementSource).toContain("setPlacementViewMode('boxes')")
  })

  it('keeps every item as a pin even when one is selected', () => {
    const html = renderToStaticMarkup(<AfternoonTeaItemPlacement
      imageSrc="data:image/png;base64,AQID"
      items={items}
      regions={regions}
      locked={false}
      selectedIndex={0}
      onChange={() => {}}
    />)

    expect((html.match(/data-item-title-pin=/g) ?? [])).toHaveLength(items.length)
    expect(html).not.toContain('aria-label="商品 蟹肉沙拉紫菜包饭 标题位置"')
    expect(placementSource).not.toContain('handleStagePointerDown')
  })

  it('commits pointer movement only on pointerup', () => {
    const commitStart = placementSource.indexOf('const commitDrag =')
    const commitEnd = placementSource.indexOf('const cancelDrag =', commitStart)
    const commitSource = placementSource.slice(commitStart, commitEnd)

    expect(commitStart).toBeGreaterThan(-1)
    expect(placementSource).toContain('setPointerCapture')
    expect(placementSource).toContain('setPreviewRegions')
    expect(commitSource).toContain('props.onChange(drag.latestRegions)')
    expect(placementSource).toContain('onPointerUp={commitDrag}')
    expect(placementSource).toContain('aspectRatio')
  })

  it('gives the active mobile title box a real pointer hit target', () => {
    expect(placementSource).toContain('pointer-events-auto')
    expect(placementSource).toContain('onPointerDown={(event) => handlePointerDown(index, event)}')
    expect(placementSource).toContain('onPointerMove={handlePointerMove}')
    expect(placementSource).toContain('onPointerUp={commitDrag}')
    expect(placementSource).toContain('onPointerCancel={cancelDrag}')
    expect(placementSource).toContain('onLostPointerCapture={cancelDrag}')
  })

  it('restores the drag start and does not commit on pointercancel or lost capture', () => {
    const cancelStart = placementSource.indexOf('const cancelDrag =')
    const cancelEnd = placementSource.indexOf('const handlePointerDown =', cancelStart)
    const cancelSource = placementSource.slice(cancelStart, cancelEnd)

    expect(cancelStart).toBeGreaterThan(-1)
    expect(cancelSource).toContain('setPreviewRegions(drag.startRegions)')
    expect(cancelSource).not.toContain('props.onChange')
    expect(placementSource).toContain('onPointerCancel={cancelDrag}')
    expect(placementSource).toContain('onLostPointerCapture={cancelDrag}')
  })

  it('keeps a loaded image size associated with its source instead of clearing it after load', () => {
    expect(placementSource).toContain("loadedImageSize?.src === props.imageSrc")
    expect(placementSource).toContain("src: props.imageSrc")
    expect(placementSource).not.toContain('setImageSize(null)')
  })

  it('exposes an image loading state and hides interactive boxes until natural dimensions are known', () => {
    const html = renderToStaticMarkup(<AfternoonTeaItemPlacement
      imageSrc="data:image/png;base64,AQID"
      items={items}
      regions={regions}
      locked={false}
      onChange={() => {}}
    />)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('图片加载中')
    expect(html).not.toContain('>可拖动<')
    expect(html.match(/<button[^>]*data-item-title-box="0"[^>]*>/)?.[0]).toContain('invisible')
    expect(html.match(/<button[^>]*data-item-title-box="0"[^>]*>/)?.[0]).toContain('pointer-events-none')
    expect(html.match(/<button[^>]*data-item-title-box="0"[^>]*>/)?.[0]).toContain('disabled=""')
  })

  it('renders a non-editable empty state without an image', () => {
    const html = renderToStaticMarkup(<AfternoonTeaItemPlacement
      imageSrc=""
      items={items}
      regions={regions}
      locked={false}
      onChange={() => {}}
    />)

    expect(html).toContain('解析已完成，请粘贴或上传餐品图片')
    expect(html).not.toContain('data-item-title-box=')
  })
})
