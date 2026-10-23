import { describe, expect, it } from 'vitest'
import { clientWhatsapp, framelinePlanLine } from './gallery-text'

const gallery = {
  gallery_url: 'https://g.example/AB12CD3', short_id: 'AB12CD3', pin: '4821', full_access_pin: null,
  photo_count: 12, visits: 0, guests: null, expires_at: null, created_at: '2026-10-12T00:00:00Z',
}
const to = (phone: string | null) => {
  const wa = clientWhatsapp({ name: 'Priya Sharma', phone }, 'Wedding', gallery)
  return wa ? new URL(wa.href).pathname.slice(1) : null
}

describe("the client's WhatsApp link", () => {
  it('reaches the same chat however the number was typed', () => {
    expect(to('9845055012')).toBe('919845055012')
    expect(to('09845055012')).toBe('919845055012')
    expect(to('098450 55012')).toBe('919845055012')
    expect(to('+91 98450-55012')).toBe('919845055012')
    expect(to('919845055012')).toBe('919845055012')
  })

  it('needs a number, and greets by first name with the PIN', () => {
    expect(to(null)).toBeNull()
    expect(to('  ')).toBeNull()
    const wa = clientWhatsapp({ name: 'Priya Sharma', phone: '9845055012' }, 'Wedding', gallery)!
    expect(wa.firstName).toBe('Priya')
    expect(new URL(wa.href).searchParams.get('text')).toContain('PIN for your guests: 4821')
  })
})

describe('the Frameline plan line', () => {
  const now = Date.parse('2026-10-23T06:00:00Z')
  it('says till when while it runs, and that it ended once it has', () => {
    expect(framelinePlanLine('starter', '2027-03-03T00:00:00Z', now)).toEqual({ text: 'Starter plan till 3 Mar 2027', ended: false })
    expect(framelinePlanLine('starter', '2026-10-01T00:00:00Z', now)).toEqual({ text: 'Starter plan ended on 1 Oct 2026. Renew it in Frameline.', ended: true })
    expect(framelinePlanLine(null, null, now)).toBeNull()
    expect(framelinePlanLine('pro', null, now)).toEqual({ text: 'Pro plan', ended: false })
  })
})
