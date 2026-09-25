import { describe, expect, it } from 'vitest'
import { badgeText, notificationTarget, splitDeepLink, timeAgo } from './notification-view'

const NOW = new Date('2026-09-25T10:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('timeAgo', () => {
  it('is "just now" for the last minute, and for a clock running a little fast', () => {
    expect(timeAgo(ago(20_000), NOW)).toBe('just now')
    expect(timeAgo(ago(-30_000), NOW)).toBe('just now')
  })

  it('counts minutes, then hours, then days', () => {
    expect(timeAgo(ago(5 * MIN), NOW)).toBe('5m ago')
    expect(timeAgo(ago(59 * MIN), NOW)).toBe('59m ago')
    expect(timeAgo(ago(60 * MIN), NOW)).toBe('1h ago')
    expect(timeAgo(ago(2 * HOUR + 40 * MIN), NOW)).toBe('2h ago')
    expect(timeAgo(ago(23 * HOUR + 59 * MIN), NOW)).toBe('23h ago')
    expect(timeAgo(ago(DAY), NOW)).toBe('1d ago')
    expect(timeAgo(ago(6 * DAY + 23 * HOUR), NOW)).toBe('6d ago')
  })

  it('gives the date after a week, in India', () => {
    // 18:45 UTC on 12 Sep is already the 13th in Kolkata.
    expect(timeAgo('2026-09-12T18:45:00Z', NOW)).toBe('13 Sep')
  })

  it('adds the year once it is not this one', () => {
    expect(timeAgo('2025-12-30T10:00:00Z', NOW)).toBe('30 Dec 2025')
  })

  it('says nothing for a time it cannot read', () => {
    expect(timeAgo('not a time', NOW)).toBe('')
  })
})

describe('splitDeepLink', () => {
  it('keeps a plain path as it is', () => {
    expect(splitDeepLink('/my-work')).toEqual({ to: '/my-work' })
  })

  it('splits the query off, so the router can match the path', () => {
    expect(splitDeepLink('/projects/p1?tab=deliverables&d=d1')).toEqual({
      to: '/projects/p1',
      search: { tab: 'deliverables', d: 'd1' },
    })
    expect(splitDeepLink('/follow-ups?lead=abc')).toEqual({ to: '/follow-ups', search: { lead: 'abc' } })
  })

  it('drops an empty query and a hash', () => {
    expect(splitDeepLink('/reminders?')).toEqual({ to: '/reminders' })
    expect(splitDeepLink('/reminders#top')).toEqual({ to: '/reminders' })
  })

  it('will not follow anything outside the app', () => {
    expect(splitDeepLink('https://example.com/x')).toBeNull()
    expect(splitDeepLink('//example.com/x')).toBeNull()
    expect(splitDeepLink('/\\example.com')).toBeNull()
    expect(splitDeepLink('javascript:alert(1)')).toBeNull()
    expect(splitDeepLink('')).toBeNull()
  })
})

describe('notificationTarget', () => {
  it('follows the deep link when there is one', () => {
    expect(notificationTarget({ type: 'reminder', deep_link: '/shoots/s1' })).toEqual({ to: '/shoots/s1' })
    expect(notificationTarget({ type: 'deliverable_note', deep_link: '/projects/p1?tab=deliverables&d=d1' })).toEqual({
      to: '/projects/p1',
      search: { tab: 'deliverables', d: 'd1' },
    })
  })

  it('sends a reminder with no link to the reminders board', () => {
    expect(notificationTarget({ type: 'reminder', deep_link: null })).toEqual({ to: '/reminders' })
    expect(notificationTarget({ type: 'reminder.due', deep_link: null })).toEqual({ to: '/reminders' })
  })

  it('opens the Alerts page for anything else without a usable link', () => {
    expect(notificationTarget({ type: 'work', deep_link: null })).toEqual({ to: '/notifications' })
    expect(notificationTarget({ type: 'work', deep_link: 'https://example.com' })).toEqual({ to: '/notifications' })
  })
})

describe('badgeText', () => {
  it('counts up to nine, then says 9+', () => {
    expect(badgeText(1)).toBe('1')
    expect(badgeText(9)).toBe('9')
    expect(badgeText(10)).toBe('9+')
    expect(badgeText(250)).toBe('9+')
  })
})
