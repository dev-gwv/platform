import { describe, expect, it } from 'vitest'
import { amountsHidden, MASK, screenINR, setAmountsHidden, subscribeAmounts } from './hide'

describe('hide amounts', () => {
  it('shows rupees until hidden, then the mask', () => {
    setAmountsHidden(false)
    expect(screenINR(120000)).toBe('₹1,20,000')
    setAmountsHidden(true)
    expect(screenINR(120000)).toBe(MASK)
    expect(screenINR(120000, false)).toBe('₹1,20,000')
    setAmountsHidden(false)
  })

  it('tells listeners only when it changes', () => {
    let n = 0
    const off = subscribeAmounts(() => n++)
    setAmountsHidden(true)
    setAmountsHidden(true)
    setAmountsHidden(false)
    off()
    setAmountsHidden(true)
    expect(n).toBe(2)
    expect(amountsHidden()).toBe(true)
    setAmountsHidden(false)
  })
})
