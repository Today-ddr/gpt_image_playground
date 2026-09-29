// @vitest-environment happy-dom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useImageLoadState } from './useImageLoadState'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Probe({ src }: { src: string }) {
  const state = useImageLoadState(src)
  return (
    <img
      ref={state.imgRef}
      src={src}
      alt=""
      data-loaded={state.loaded ? '1' : '0'}
      className={state.loaded ? 'opacity-100' : 'opacity-0'}
      onLoad={state.onLoad}
      onError={state.onError}
    />
  )
}

describe('useImageLoadState', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  async function render(node: ReactElement) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(node)
    })
    return host.querySelector('img')
  }

  it('stays unloaded until onLoad and keeps the image in layout', async () => {
    const img = await render(<Probe src="data:image/png;base64,ZmluYWw=" />)
    expect(img).toBeTruthy()
    expect(img?.className).toContain('opacity-0')
    expect(img?.className).not.toContain('hidden')

    await act(async () => {
      img?.dispatchEvent(new Event('load'))
    })
    expect(img?.getAttribute('data-loaded')).toBe('1')
    expect(img?.className).toContain('opacity-100')
  })
})
