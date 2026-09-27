import { describe, expect, it } from 'vitest'
import headerSource from './Header.tsx?raw'

describe('Header mobile mode navigation', () => {
  it('uses the gallery scroll-collapse behavior in tools mode too', () => {
    expect(headerSource.match(/appMode !== 'agent' && scrollDirection === 'down'/g)).toHaveLength(2)
  })

  it('does not offer the Agent mode tab', () => {
    expect(headerSource).not.toContain("setAppMode('agent')")
    expect(headerSource).toContain('max-w-[16.5rem]')
    expect(headerSource).toContain('min-h-11')
    expect(headerSource).not.toContain('grid-cols-3')
  })
})
