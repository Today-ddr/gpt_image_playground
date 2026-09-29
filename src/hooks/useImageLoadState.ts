import { useLayoutEffect, useRef, useState } from 'react'

/** data URL / 缓存图可能在 onLoad 绑定前就 complete；opacity 代替 hidden，避免 Safari 不解码。 */
export function useImageLoadState(src: string) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [loaded, setLoaded] = useState(false)

  useLayoutEffect(() => {
    setLoaded(false)
    if (!src) return
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true)
  }, [src])

  return {
    imgRef,
    loaded,
    onLoad: () => setLoaded(true),
    onError: () => setLoaded(false),
  }
}
