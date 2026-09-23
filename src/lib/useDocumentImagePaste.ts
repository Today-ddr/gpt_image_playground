import { useEffect, useRef } from 'react'

export type DocumentImagePasteOptions = {
  disabled?: boolean
  onImages: (files: File[]) => boolean
}

function getEventTargetTagName(target: EventTarget | null) {
  if (!target || typeof target !== 'object') return ''
  const tagName = (target as { tagName?: unknown }).tagName
  return typeof tagName === 'string' ? tagName.toUpperCase() : ''
}

export function isEditableTextPasteTarget(target: EventTarget | null) {
  const tagName = getEventTargetTagName(target)
  if (tagName === 'TEXTAREA') return true
  if (tagName === 'INPUT') {
    const type = String((target as { type?: unknown }).type || 'text').toLowerCase()
    return type !== 'button'
      && type !== 'checkbox'
      && type !== 'color'
      && type !== 'file'
      && type !== 'hidden'
      && type !== 'image'
      && type !== 'radio'
      && type !== 'range'
      && type !== 'reset'
      && type !== 'submit'
  }
  return Boolean(target && (target as { isContentEditable?: unknown }).isContentEditable)
}

export function shouldDeferDocumentImagePaste(event: Event) {
  return isEditableTextPasteTarget(event.target) && clipboardEventHasPlainText(event)
}

export function clipboardEventHasPlainText(event: Event) {
  const text = (event as ClipboardEvent).clipboardData?.getData?.('text/plain')
  return Boolean(text && text.trim())
}

export function subscribeDocumentImagePaste(
  target: EventTarget,
  getOptions: () => DocumentImagePasteOptions,
) {
  const handlePaste = (event: Event) => {
    const options = getOptions()
    if (options.disabled) return
    // 菜单框粘贴常是图文混排；截获图片并 preventDefault 会让菜单文字贴不进去。
    if (shouldDeferDocumentImagePaste(event)) return

    const items = (event as ClipboardEvent).clipboardData?.items
    if (!items) return

    const files = Array.from(items).flatMap((item) => {
      if (!item.type.startsWith('image/')) return []
      const file = item.getAsFile()
      return file?.type.startsWith('image/') ? [file] : []
    })
    if (files.length === 0) return
    if (options.onImages(files)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const listenerOptions = { capture: true } as const
  target.addEventListener('paste', handlePaste, listenerOptions)
  return () => target.removeEventListener('paste', handlePaste, listenerOptions)
}

export function useDocumentImagePaste(
  onImages: (files: File[]) => boolean,
  disabled = false,
) {
  const optionsRef = useRef<DocumentImagePasteOptions>({ disabled, onImages })
  optionsRef.current = { disabled, onImages }

  useEffect(() => {
    return subscribeDocumentImagePaste(document, () => optionsRef.current)
  }, [])
}
