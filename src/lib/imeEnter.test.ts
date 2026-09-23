import { describe, expect, it } from 'vitest'
import { isImeEnter } from './imeEnter'

describe('isImeEnter', () => {
  it('treats composing Enter as IME confirm', () => {
    expect(isImeEnter({ key: 'Enter', isComposing: true, keyCode: 13 }, false)).toBe(true)
    expect(isImeEnter({ key: 'Enter', isComposing: false, keyCode: 229 }, false)).toBe(true)
    expect(isImeEnter({ key: 'Enter', isComposing: false, keyCode: 13 }, true)).toBe(true)
  })

  it('lets a normal Enter through', () => {
    expect(isImeEnter({ key: 'Enter', isComposing: false, keyCode: 13 }, false)).toBe(false)
  })
})
