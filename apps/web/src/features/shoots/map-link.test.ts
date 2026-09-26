import { describe, expect, it } from 'vitest'
import { mapHref, mapSearchHref } from './map-link'

describe('mapHref', () => {
  it('passes a web link through, http or https, any case', () => {
    expect(mapHref('https://maps.app.goo.gl/abc')).toBe('https://maps.app.goo.gl/abc')
    expect(mapHref('http://maps.google.com/?q=x')).toBe('http://maps.google.com/?q=x')
    expect(mapHref('HTTPS://maps.app.goo.gl/abc')).toBe('HTTPS://maps.app.goo.gl/abc')
  })

  it('does not link a short link pasted without its scheme', () => {
    expect(mapHref('maps.app.goo.gl/x')).toBeNull()
  })

  it('does not link plain text or a plus code', () => {
    expect(mapHref('Taj Palace, Jaipur (shared from WhatsApp)')).toBeNull()
    expect(mapHref('7JVW52GR+3V')).toBeNull()
  })

  it('trims whitespace around the link', () => {
    expect(mapHref('  https://maps.app.goo.gl/abc \n')).toBe('https://maps.app.goo.gl/abc')
  })

  it('is null for nothing', () => {
    expect(mapHref(null)).toBeNull()
    expect(mapHref(undefined)).toBeNull()
    expect(mapHref('')).toBeNull()
    expect(mapHref('   ')).toBeNull()
  })
})

describe('mapSearchHref', () => {
  it('encodes the venue into a Google Maps search', () => {
    expect(mapSearchHref('Taj Palace, Jaipur')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Taj%20Palace%2C%20Jaipur',
    )
  })
})
