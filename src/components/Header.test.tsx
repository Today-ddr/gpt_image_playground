import { describe, expect, it } from 'vitest'
import headerSource from './Header.tsx?raw'

describe('Header mobile mode navigation', () => {
  it('uses the gallery scroll-collapse behavior in tools mode too', () => {
    expect(headerSource.match(/appMode !== 'agent' && scrollDirection === 'down'/g)).toHaveLength(2)
  })
})
