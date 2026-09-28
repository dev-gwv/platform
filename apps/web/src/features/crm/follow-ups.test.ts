import { describe, expect, it } from 'vitest'
import { dueWords, followUpBucket, presetAt, shouldRemind } from './follow-ups'

// Sun 28 Sep 2026, 16:00 local.
const NOW = new Date(2026, 8, 28, 16, 0)

describe('followUpBucket', () => {
  it('sorts by the viewer’s day, not 24-hour windows', () => {
    expect(followUpBucket(new Date(2026, 8, 28, 15, 59), NOW)).toBe('overdue')
    expect(followUpBucket(new Date(2026, 8, 28, 23, 59), NOW)).toBe('today')
    expect(followUpBucket(new Date(2026, 8, 29, 0, 0), NOW)).toBe('tomorrow')
    expect(followUpBucket(new Date(2026, 9, 4, 23, 0), NOW)).toBe('week')
    expect(followUpBucket(new Date(2026, 9, 5, 0, 0), NOW)).toBe('later')
  })
})

describe('presetAt', () => {
  it('puts morning follow-ups at 11', () => {
    expect(presetAt('tomorrow', NOW)).toEqual(new Date(2026, 8, 29, 11, 0))
    expect(presetAt('three_days', NOW)).toEqual(new Date(2026, 9, 1, 11, 0))
    expect(presetAt('next_week', NOW)).toEqual(new Date(2026, 9, 5, 11, 0))
  })

  it('makes "today" two hours out, or 6 pm, and never after 9 pm', () => {
    expect(presetAt('today', NOW)).toEqual(new Date(2026, 8, 28, 18, 0))
    expect(presetAt('today', new Date(2026, 8, 28, 17, 30))).toEqual(new Date(2026, 8, 28, 19, 30))
    expect(presetAt('today', new Date(2026, 8, 28, 20, 0))).toEqual(new Date(2026, 8, 28, 21, 0))
  })
})

describe('dueWords', () => {
  it('says late in days once a day has passed', () => {
    expect(dueWords(new Date(2026, 8, 26, 11, 0), NOW)).toBe('2 days late')
    expect(dueWords(new Date(2026, 8, 29, 11, 0), NOW)).toMatch(/^Tomorrow/)
  })
})

describe('shouldRemind', () => {
  it('fires in the ten minutes before and the first minute after', () => {
    expect(shouldRemind(new Date(NOW.getTime() + 11 * 60_000), NOW)).toBe(false)
    expect(shouldRemind(new Date(NOW.getTime() + 9 * 60_000), NOW)).toBe(true)
    expect(shouldRemind(new Date(NOW.getTime() - 30_000), NOW)).toBe(true)
    expect(shouldRemind(new Date(NOW.getTime() - 2 * 60_000), NOW)).toBe(false)
  })
})
