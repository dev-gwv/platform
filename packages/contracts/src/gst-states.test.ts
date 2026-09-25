import { describe, expect, it } from 'vitest'
import { placeOfSupplyLabel, stateCodeFromGstin } from './gst-states'

describe('GST states', () => {
  it('names a place of supply the way a tax invoice prints it', () => {
    expect(placeOfSupplyLabel('09')).toBe('Uttar Pradesh (09)')
    expect(placeOfSupplyLabel('7')).toBe('Delhi (07)')
    expect(placeOfSupplyLabel('')).toBeNull()
    expect(placeOfSupplyLabel('99')).toBe('99')
  })
  it('reads the state from a GSTIN', () => {
    expect(stateCodeFromGstin('09ABWFA5316N1ZQ')).toBe('09')
    expect(stateCodeFromGstin('27ABCDE1234F1Z5')).toBe('27')
    expect(stateCodeFromGstin('00ABCDE1234F1Z5')).toBeNull()
    expect(stateCodeFromGstin(null)).toBeNull()
  })
})
