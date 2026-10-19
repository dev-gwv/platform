import { describe, expect, it } from 'vitest'
import { formatIndianPhone, joinKinds, partnerCounts, partnerPageText, splitKinds, toIndianMobile, waDigits, whatsappUrl } from './enquiry-share'

describe('enquiry share', () => {
  it('turns any way of writing a number into wa.me digits', () => {
    expect(waDigits('+91 98769 21126')).toBe('919876921126')
    expect(waDigits('09876921126')).toBe('919876921126')
    expect(waDigits('9876921126')).toBe('919876921126')
    expect(waDigits('123')).toBeNull()
    expect(whatsappUrl('9876921126', 'Hi there!\n\nName: A')).toBe('https://wa.me/919876921126?text=Hi%20there!%0A%0AName%3A%20A')
  })

  it('formats and stores Indian mobiles', () => {
    expect(formatIndianPhone('+919876921126')).toBe('+91 98769 21126')
    expect(toIndianMobile('098769 21126')).toBe('+919876921126')
    expect(toIndianMobile('12345')).toBeNull()
  })

  it('says counts in plain words', () => {
    expect(partnerCounts(1, 1, 0)).toBe('1 scan · 1 enquiry')
    expect(partnerCounts(12, 4, 1)).toBe('12 scans · 4 enquiries · 1 booked')
  })

  it('keeps kinds as one text', () => {
    expect(joinKinds(['Boutique', ' Salon ', 'Boutique'])).toBe('Boutique, Salon')
    expect(splitKinds('Boutique, Mehendi artist')).toEqual(['Boutique', 'Mehendi artist'])
    expect(partnerPageText('Riya Kapoor', 'Asha Studio', 'L')).toBe(
      'Hi Riya, here is your page for enquiries that come to Asha Studio through your QR code. You can see each one and where it stands: L',
    )
  })
})
