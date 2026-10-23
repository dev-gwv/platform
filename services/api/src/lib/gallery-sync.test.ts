import { describe, expect, it } from 'vitest'
import { galleryForClient } from './gallery-sync'
import { createFailure } from '../modules/projects/routes-gallery'

const card = { url: 'https://g.example/AB12CD3', pin: '4821', full_access_pin: null }
const now = Date.parse('2026-10-23T06:00:00Z')

describe('the gallery on the client\'s page', () => {
  it('waits for the first photo', () => {
    expect(galleryForClient(card, { photo_count: 0, expires_at: '2027-10-23T00:00:00Z' }, now)).toBeNull()
    expect(galleryForClient(card, { photo_count: null, expires_at: null }, now)).toBeNull()
    expect(galleryForClient(card, { photo_count: 12, expires_at: '2027-10-23T00:00:00Z' }, now)).toBe(card)
  })

  it('goes once the gallery has closed, and with the kept row', () => {
    expect(galleryForClient(card, { photo_count: 12, expires_at: '2026-10-01T00:00:00+05:30' }, now)).toBeNull()
    expect(galleryForClient(card, { photo_count: 12, expires_at: null }, now)).toBe(card)
    expect(galleryForClient(card, null, now)).toBeNull()
    expect(galleryForClient(null, { photo_count: 12, expires_at: null }, now)).toBeNull()
  })
})

describe('what a failed Create gallery says', () => {
  it('sends a link only we can fix to a support call, and a blip to "try again"', () => {
    expect(createFailure('misconfigured')).toMatchObject({ status: 502, message: expect.stringContaining('support call') })
    expect(createFailure('not_connected')).toMatchObject({ status: 502 })
    expect(createFailure('unreachable')).toMatchObject({ status: 503, message: expect.stringContaining('try again') })
    expect(createFailure('refused')).toMatchObject({ status: 503 })
    expect(createFailure('owner_first').status).toBe(409)
    expect(createFailure('no_name')).toMatchObject({ status: 503, message: expect.stringContaining('name') })
  })
})
