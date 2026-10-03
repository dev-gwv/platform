import { describe, expect, it } from 'vitest'
import { brandingGaps } from './branding'

describe('brandingGaps', () => {
  const full = { invoice_address: 'Pune', invoice_phone: '98765 43210', invoice_email: 'hi@studio.in' }

  it('says nothing when only the logo (or GST) is missing', () => {
    expect(brandingGaps(full)).toEqual([])
  })

  it('names the contact details a client would need', () => {
    expect(brandingGaps({ ...full, invoice_phone: null, invoice_email: ' ' })).toEqual(['phone', 'email'])
    expect(brandingGaps(null)).toEqual([])
  })
})
