import { describe, expect, it, vi } from 'vitest'

import {
  clipboardEventHasPlainText,
  isEditableTextPasteTarget,
  shouldDeferDocumentImagePaste,
  subscribeDocumentImagePaste,
  type DocumentImagePasteOptions,
} from './useDocumentImagePaste'

function createPasteEvent(
  items: Array<{ type: string; getAsFile: () => File | null }>,
  text = '',
) {
  const event = new Event('paste', { cancelable: true, bubbles: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items,
      getData: (type: string) => type === 'text/plain' ? text : '',
    },
  })
  return event
}

function imageItem(name = 'image.png', type = 'image/png') {
  const file = new File(['image'], name, { type })
  return {
    file,
    item: {
      type,
      getAsFile: () => file,
    },
  }
}

describe('subscribeDocumentImagePaste', () => {
  it('passes valid pasted images to the current callback and prevents the accepted paste', () => {
    const target = new EventTarget()
    const first = imageItem('first.png')
    const second = imageItem('second.webp', 'image/webp')
    const onImages = vi.fn(() => true)
    const options: DocumentImagePasteOptions = { disabled: false, onImages }
    subscribeDocumentImagePaste(target, () => options)

    const event = createPasteEvent([
      { type: 'text/plain', getAsFile: () => null },
      first.item,
      second.item,
    ])
    target.dispatchEvent(event)

    expect(onImages).toHaveBeenCalledWith([first.file, second.file])
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not prevent disabled, text-only, invalid-image, or rejected pastes', () => {
    const target = new EventTarget()
    const image = imageItem()
    const onImages = vi.fn(() => false)
    let options: DocumentImagePasteOptions = { disabled: true, onImages }
    subscribeDocumentImagePaste(target, () => options)

    const disabledEvent = createPasteEvent([image.item])
    target.dispatchEvent(disabledEvent)
    expect(disabledEvent.defaultPrevented).toBe(false)
    expect(onImages).not.toHaveBeenCalled()

    options = { disabled: false, onImages }
    const textEvent = createPasteEvent([{ type: 'text/plain', getAsFile: () => null }])
    target.dispatchEvent(textEvent)
    expect(textEvent.defaultPrevented).toBe(false)

    const invalidImageEvent = createPasteEvent([
      { type: 'image/png', getAsFile: () => null },
      { type: 'image/png', getAsFile: () => new File(['text'], 'not-image.txt', { type: 'text/plain' }) },
    ])
    target.dispatchEvent(invalidImageEvent)
    expect(invalidImageEvent.defaultPrevented).toBe(false)

    const rejectedEvent = createPasteEvent([image.item])
    target.dispatchEvent(rejectedEvent)
    expect(rejectedEvent.defaultPrevented).toBe(false)
    expect(onImages).toHaveBeenCalledTimes(1)
  })

  it('uses the latest options without adding another listener and removes the listener on cleanup', () => {
    const target = new EventTarget()
    const addEventListener = vi.spyOn(target, 'addEventListener')
    const removeEventListener = vi.spyOn(target, 'removeEventListener')
    const image = imageItem()
    const firstCallback = vi.fn(() => true)
    const secondCallback = vi.fn(() => true)
    let options: DocumentImagePasteOptions = { disabled: false, onImages: firstCallback }

    const cleanup = subscribeDocumentImagePaste(target, () => options)
    options = { disabled: false, onImages: secondCallback }
    target.dispatchEvent(createPasteEvent([image.item]))

    expect(addEventListener).toHaveBeenCalledTimes(1)
    expect(firstCallback).not.toHaveBeenCalled()
    expect(secondCallback).toHaveBeenCalledTimes(1)

    addEventListener.mockRestore()
    removeEventListener.mockRestore()
    cleanup()
    target.dispatchEvent(createPasteEvent([image.item]))

    expect(secondCallback).toHaveBeenCalledTimes(1)
  })

  it('listens on the capture phase so image pastes do not update focused text fields', () => {
    const target = new EventTarget()
    const addEventListener = vi.spyOn(target, 'addEventListener')
    const removeEventListener = vi.spyOn(target, 'removeEventListener')
    const cleanup = subscribeDocumentImagePaste(target, () => ({ disabled: false, onImages: () => true }))

    expect(addEventListener).toHaveBeenCalledWith('paste', expect.any(Function), { capture: true })
    cleanup()
    expect(removeEventListener).toHaveBeenCalledWith('paste', expect.any(Function), { capture: true })
  })

  it('does not steal mixed text and image pastes from a menu textarea', () => {
    const event = createPasteEvent([
      { type: 'text/plain', getAsFile: () => null },
      imageItem().item,
    ], '今日菜单：草莓蛋糕')
    Object.defineProperty(event, 'target', { value: { tagName: 'TEXTAREA' } })

    expect(isEditableTextPasteTarget(event.target)).toBe(true)
    expect(clipboardEventHasPlainText(event)).toBe(true)
    expect(shouldDeferDocumentImagePaste(event)).toBe(true)
    expect(shouldDeferDocumentImagePaste(createPasteEvent([imageItem().item], '今日菜单：草莓蛋糕'))).toBe(false)
  })

  it('still intercepts image-only pastes even when a textarea is focused', () => {
    const event = createPasteEvent([imageItem().item])
    Object.defineProperty(event, 'target', { value: { tagName: 'TEXTAREA' } })

    expect(clipboardEventHasPlainText(event)).toBe(false)
    expect(shouldDeferDocumentImagePaste(event)).toBe(false)
  })
})
