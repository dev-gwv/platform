import { describe, expect, it } from 'vitest'
import { waLink, waLinkOrShare, waNumber, waShare } from './whatsapp'

describe('waNumber', () => {
  it('gives a bare Indian number its code, however it was typed', () => {
    for (const typed of ['9876543210', '98765 43210', '98765-43210', '(98765) 43210', '09876543210', '098765 43210', '919876543210', '+91 98765 43210', '+919876543210', '0091 98765 43210', '+91 098765 43210', ' +91-98765-43210 ']) {
      expect(waNumber(typed), typed).toBe('919876543210')
    }
  })

  it('keeps a number that already has another country code', () => {
    expect(waNumber('+44 7700 900123')).toBe('447700900123')
    expect(waNumber('+1 415 555 0101')).toBe('14155550101')
    expect(waNumber('+44 20 7946 0958')).toBe('442079460958')
    expect(waNumber('0044 7700 900123')).toBe('447700900123')
    expect(waNumber('14155550101')).toBe('14155550101')
    expect(waNumber('971501234567')).toBe('971501234567')
  })

  it('refuses what cannot be a phone', () => {
    for (const typed of [null, undefined, '', '   ', '123', '12345', 'call me', '0000000000', '+0 123', '1234567890123456']) {
      expect(waNumber(typed), String(typed)).toBeNull()
    }
  })
})

describe('waLink', () => {
  it('opens the chat, with the text typed in when given', () => {
    expect(waLink('98765 43210')).toBe('https://wa.me/919876543210')
    expect(waLink('09876543210', 'Hi there')).toBe('https://wa.me/919876543210?text=Hi%20there')
    expect(waLink('+44 7700 900123', 'Hi & bye\n2')).toBe('https://wa.me/447700900123?text=Hi%20%26%20bye%0A2')
  })

  it('is null without a number it can use', () => {
    expect(waLink('123', 'x')).toBeNull()
    expect(waLink(null, 'x')).toBeNull()
  })
})

describe('waShare and waLinkOrShare', () => {
  it('lets WhatsApp ask whom to send it to when there is no number', () => {
    expect(waShare('Our gallery: https://x.in/g?a=1')).toBe('https://wa.me/?text=Our%20gallery%3A%20https%3A%2F%2Fx.in%2Fg%3Fa%3D1')
    expect(waLinkOrShare(null, 'Hi')).toBe('https://wa.me/?text=Hi')
    expect(waLinkOrShare('123', 'Hi')).toBe('https://wa.me/?text=Hi')
    expect(waLinkOrShare('9876921126', 'Hi there!\n\nName: A')).toBe('https://wa.me/919876921126?text=Hi%20there!%0A%0AName%3A%20A')
  })
})
