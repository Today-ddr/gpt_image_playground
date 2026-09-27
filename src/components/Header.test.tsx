import { describe, expect, it } from 'vitest'
import headerSource from './Header.tsx?raw'

describe('Header mobile mode navigation', () => {
  it('puts the mode switch in the mobile header row and keeps the title for desktop', () => {
    expect(headerSource).toContain('w-full max-w-[16.5rem] sm:hidden')
    expect(headerSource).toContain('hidden min-w-0 items-start relative mr-2 sm:inline-flex')
    expect(headerSource).not.toContain('max-h-14')
    expect(headerSource).not.toContain("setAppMode('agent')")
    expect(headerSource).toContain('min-h-8')
  })
})
