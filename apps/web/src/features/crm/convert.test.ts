import { describe, expect, it } from 'vitest'
import { convertDefaults } from './convert'

describe('convertDefaults', () => {
  it('starts from the lead name and its budget', () => {
    expect(convertDefaults({ name: 'Priya Sharma', deal_value: 250000 })).toEqual({ name: 'Priya Sharma project', cost: '250000' })
  })
  it('leaves the price empty without a budget', () => {
    expect(convertDefaults({ name: null, deal_value: null })).toEqual({ name: 'New project', cost: '' })
    expect(convertDefaults({ name: 'A', deal_value: 0 }).cost).toBe('')
  })
})
