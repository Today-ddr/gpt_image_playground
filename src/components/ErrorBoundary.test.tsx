// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary, isChunkLoadError } from './ErrorBoundary'
import appSource from '../App.tsx?raw'
import mainSource from '../main.tsx?raw'
import swSource from '../../public/sw.js?raw'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Boom() {
  throw new Error('render boom')
}

describe('ErrorBoundary', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    vi.restoreAllMocks()
  })

  async function render(node: ReactNode) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(node)
    })
  }

  it('shows a refresh action instead of leaving the page blank', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(host?.textContent).toContain('页面加载失败')
    expect(host?.textContent).toContain('刷新页面')
  })

  it('detects hashed chunk load failures', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/foo.js'))).toBe(true)
    expect(isChunkLoadError(new Error('render boom'))).toBe(false)
  })
})

describe('blank page recovery wiring', () => {
  it('mounts the app behind an error boundary and recreates #root if missing', () => {
    expect(mainSource).toContain('ErrorBoundary')
    expect(mainSource).toContain('function ensureRoot')
    expect(mainSource).toContain('controllerchange')
    expect(appSource).toContain('初始化本地数据失败')
  })

  it('does not cache failed navigations and prefers network for hashed assets', () => {
    expect(swSource).toContain('if (response.ok)')
    expect(swSource).toContain('url.pathname.startsWith(ASSETS_PATH)')
    expect(swSource).toContain('gpt-image-playground-v0.8.3-net1')
  })
})
