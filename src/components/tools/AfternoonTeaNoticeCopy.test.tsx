// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AfternoonTeaNotice } from '../../lib/afternoonTeaNotice'
import { AfternoonTeaNoticePanel } from './AfternoonTeaNoticePanel'
import { AfternoonTeaNoticeFormView, type AfternoonTeaNoticeFormViewProps } from './AfternoonTeaNoticeWorkflow'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const notices: AfternoonTeaNotice[] = [
  { style: '可爱活泼', text: '第一张通知' },
  { style: '可爱活泼', text: '第二张通知' },
]

function flashText(button: Element) {
  return button.querySelector('[role="status"]')?.textContent ?? ''
}

function cards(host: HTMLElement) {
  return [...host.querySelectorAll('button')].filter((button) => button.getAttribute('aria-label')?.startsWith('复制'))
}

describe('notice copy flash', () => {
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
    return cards(host)
  }

  it('shows success only on the clicked card when two cards share a style', async () => {
    let resolveCopy: () => void = () => {}
    const onCopy = vi.fn(() => new Promise<void>((resolve) => {
      resolveCopy = resolve
    }))
    const buttons = await render(
      <AfternoonTeaNoticePanel
        status="success"
        notices={notices}
        error=""
        elapsed={null}
        channel=""
        model=""
        onCopy={onCopy}
      />,
    )

    await act(async () => {
      buttons[1].click()
    })
    expect(onCopy).toHaveBeenCalledWith('第二张通知')
    await act(async () => {
      resolveCopy()
      await Promise.resolve()
    })

    expect(flashText(buttons[0])).toBe('')
    expect(flashText(buttons[1])).toBe('已复制')
  })

  it('shows a copy failure only on the clicked workflow card', async () => {
    const onCopy = vi.fn(async () => {
      throw new Error('clipboard denied')
    })
    const props: AfternoonTeaNoticeFormViewProps = {
      configured: true,
      menuText: '豆腐',
      brand: '',
      systemPrompt: '系统提示词',
      notices,
      selectedIndex: 0,
      status: 'success',
      elapsed: null,
      error: '',
      clipboardAvailable: true,
      clipboardError: '',
      sourceChannel: '',
      sourceModel: '',
      onMenuTextChange: () => {},
      onBrandChange: () => {},
      onSystemPromptChange: () => {},
      onResetSystemPrompt: () => {},
      onNoticeTextChange: () => {},
      onSelectedIndexChange: () => {},
      onPasteMenu: () => {},
      onSubmit: () => {},
      onCancel: () => {},
      onCopy,
    }
    const buttons = await render(<AfternoonTeaNoticeFormView {...props} />)

    await act(async () => {
      buttons[0].click()
      await Promise.resolve()
    })

    expect(onCopy).toHaveBeenCalledWith('第一张通知')
    expect(flashText(buttons[0])).toBe('复制失败')
    expect(flashText(buttons[1])).toBe('')
  })
})
