// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import inputBarSource from '../InputBar.tsx?raw'
import ChannelModeSwitch from './channelModeSwitch'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('gallery channel mode switch', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  async function render(node: ReactNode) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(node)
    })
    return host
  }

  it('is mounted at the front of the gallery parameter row', () => {
    const desktopRow = inputBarSource.indexOf('hidden sm:flex items-end justify-between gap-2')
    const switchAt = inputBarSource.indexOf('<ChannelModeSwitch', desktopRow)
    const paramsAt = inputBarSource.indexOf("{renderParams('grid-cols-6')}", desktopRow)
    expect(desktopRow).toBeGreaterThan(-1)
    expect(switchAt).toBeGreaterThan(desktopRow)
    expect(paramsAt).toBeGreaterThan(switchAt)
    expect(inputBarSource).not.toContain('channelModeSummary')
  })

  it('switches between single and multi channel', async () => {
    const onChange = vi.fn()
    const view = await render(
      <ChannelModeSwitch
        mode="multi"
        detail="多渠道：同时请求 中转 A、中转 B"
        onChange={onChange}
      />,
    )

    const buttons = [...view.querySelectorAll('button')]
    expect(buttons.map((button) => button.textContent)).toEqual(['单渠道', '多渠道'])
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false')
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
    expect(view.querySelector('[aria-label="生成渠道"]')?.getAttribute('title')).toContain('中转 A、中转 B')

    await act(async () => {
      buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('single')
  })

  it('does not change mode while a reused task profile locks the submit', async () => {
    const onChange = vi.fn()
    const view = await render(
      <ChannelModeSwitch
        mode="multi"
        detail="正在复用任务配置「中转 B」，本次固定单渠道"
        disabled
        onChange={onChange}
      />,
    )

    const button = view.querySelector('button')
    expect(button?.hasAttribute('disabled')).toBe(true)
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})