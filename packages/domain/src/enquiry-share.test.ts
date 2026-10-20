import { describe, expect, it } from 'vitest'
import { agoWords, formatIndianPhone, joinKinds, partnerCounts, partnerLine, partnerPageText, partnerQrText, splitKinds, toIndianMobile, topPartnerId, waDigits, whatsappUrl } from './enquiry-share'

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

  it('says a partner in one sentence, and names the top one', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    expect(agoWords('2026-10-20T01:00:00Z', now)).toBe('today')
    expect(agoWords('2026-10-19T08:00:00Z', now)).toBe('yesterday')
    expect(agoWords('2026-10-16T08:00:00Z', now)).toBe('4 days ago')
    expect(agoWords('2026-09-29T08:00:00Z', now)).toBe('3 weeks ago')
    expect(
      partnerLine({ scans: 30, enquiries: 12, booked: 3, last_enquiry_at: '2026-10-16T08:00:00Z', page_viewed_at: '2026-10-19T08:00:00Z' }, now),
    ).toBe('30 scans · 12 enquiries · 3 booked (25%) · last one 4 days ago · saw their page yesterday')
    expect(partnerLine({ scans: 1, enquiries: 0, booked: 0 }, now)).toBe('1 scan · 0 enquiries')
    const rows = [
      { id: 'a', booked: 1, enquiries: 9 },
      { id: 'b', booked: 2, enquiries: 3 },
      { id: 'c', booked: 2, enquiries: 5 },
    ]
    expect(topPartnerId(rows)).toBe('c')
    expect(topPartnerId([{ id: 'a', booked: 0, enquiries: 9 }, { id: 'b', booked: 0, enquiries: 1 }])).toBeNull()
    expect(topPartnerId([{ id: 'a', booked: 3, enquiries: 9 }])).toBeNull()
    expect(partnerQrText('Riya Kapoor', 'Asha Studio', 'L')).toBe(
      "Hi Riya, here is Asha Studio's enquiry link for your counter. Every enquiry through it is marked as yours: L",
    )
  })
})
