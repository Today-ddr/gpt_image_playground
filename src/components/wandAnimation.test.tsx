import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

const modules = import.meta.glob<{
  WandAnimation: React.ComponentType<{
    size?: number
    className?: string
    loop?: boolean
    autoplay?: boolean
  }>
}>('./wand-animation-react/index.ts')
const sources = import.meta.glob<string>('./wand-animation-react/*', {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('WandAnimation', () => {
  it('keeps the complete exported animation bundle', async () => {
    const files = ['WandAnimation.tsx', 'index.ts', 'wand.json', 'README.md']
    const missingFiles = files.filter((file) => !sources[`./wand-animation-react/${file}`])

    expect(missingFiles).toEqual([])
    if (missingFiles.length > 0) return

    const json = sources['./wand-animation-react/wand.json']
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')

    expect(hash).toBe(
      'cd91385f52e3bdff90b889162190c4d1bb51c3fc62fdc2685545e3a91ace4d7e',
    )
  })

  it('stays client-only and loads lottie-web dynamically', () => {
    const source = sources['./wand-animation-react/WandAnimation.tsx']

    expect(source.trimStart().startsWith("'use client'")).toBe(true)
    expect(source).toContain("await import('lottie-web')")
    expect(source).not.toMatch(/^import lottie/m)
  })

  it('renders an accessible decorative container with the requested size', async () => {
    const load = modules['./wand-animation-react/index.ts']

    expect(load).toBeTypeOf('function')
    if (!load) return

    const { WandAnimation } = await load()
    const html = renderToStaticMarkup(
      <WandAnimation size={72} className="wand-test" loop={false} autoplay={false} />,
    )

    expect(html).toContain('class="wand-test"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('width:72px;height:72px')
  })
})
