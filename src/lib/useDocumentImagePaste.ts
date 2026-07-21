import { useEffect, useRef } from 'react'

export type DocumentImagePasteOptions = {
  disabled?: boolean
  onImages: (files: File[]) => boolean
}

export function subscribeDocumentImagePaste(
  target: EventTarget,
  getOptions: () => DocumentImagePasteOptions,
) {
  const handlePaste = (event: Event) => {
    const options = getOptions()
    if (options.disabled) return

    const items = (event as ClipboardEvent).clipboardData?.items
    if (!items) return

    const files = Array.from(items).flatMap((item) => {
      if (!item.type.startsWith('image/')) return []
      const file = item.getAsFile()
      return file?.type.startsWith('image/') ? [file] : []
    })
    if (files.length === 0) return
    if (options.onImages(files)) event.preventDefault()
  }

  target.addEventListener('paste', handlePaste)
  return () => target.removeEventListener('paste', handlePaste)
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
