import { describe, expect, it } from 'vitest'
import { lastAmounts, usualAmounts } from './payout-memory'

const rows = (a: number[]) => a.map((amount) => ({ amount }))

describe('payout memory', () => {
  it('keeps a person\'s last amounts, newest first, each once', () => {
    expect(lastAmounts(rows([5000, 5000, 4000, 0, 3500, 3000]))).toEqual([5000, 4000, 3500])
  })
  it('ranks a role\'s amounts by how often they were paid, newest first on a tie', () => {
    expect(usualAmounts(rows([6000, 4000, 4000, 5000, 6000, 4000, 7000]))).toEqual([4000, 6000, 5000])
  })
})
