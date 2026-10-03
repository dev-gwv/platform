import { describe, expect, it } from 'vitest'
import { eventLabel, eventToShoot } from './from-client'

describe('a client’s event becomes a shoot day', () => {
  it('starts at the India time the client gave and runs for its hours', () => {
    expect(eventToShoot({ name: ' Haldi ', date: '2026-12-11', start_time: '9:30', hours: 4, venue: 'Home' })).toEqual({
      name: 'Haldi',
      shoot_date: '2026-12-11',
      start_at: '2026-12-11T04:00:00.000Z',
      end_at: '2026-12-11T08:00:00.000Z',
      location: 'Home',
    })
  })

  it('keeps just the day when there is no time, and just the name with no day', () => {
    expect(eventToShoot({ name: 'Reception', date: '2026-12-13' })).toEqual({ name: 'Reception', shoot_date: '2026-12-13' })
    expect(eventLabel({ name: 'Reception', date: '2026-12-13' })).toBe('Reception · 13 Dec')
    expect(eventLabel({ name: 'Sangeet' })).toBe('Sangeet')
  })
})
