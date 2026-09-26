import { describe, expect, it } from 'vitest'
import { absolutePortalUrl, openedAgo } from './format'

describe('openedAgo', () => {
  const now = new Date('2026-09-25T12:00:00Z')
  it('says it in plain words', () => {
    expect(openedAgo('2026-09-25T11:59:30Z', now)).toBe('just now')
    expect(openedAgo('2026-09-25T11:59:00Z', now)).toBe('1 minute ago')
    expect(openedAgo('2026-09-25T09:00:00Z', now)).toBe('3 hours ago')
    expect(openedAgo('2026-09-24T10:00:00Z', now)).toBe('yesterday')
    expect(openedAgo('2026-09-23T10:00:00Z', now)).toBe('2 days ago')
    expect(openedAgo('2026-09-04T10:00:00Z', now)).toBe('3 weeks ago')
    expect(openedAgo('2026-05-01T10:00:00Z', now)).toBe('4 months ago')
  })
})

describe('absolutePortalUrl', () => {
  it('keeps a full link and completes a bare path', () => {
    expect(absolutePortalUrl('https://app.x.in/p/abc', 'https://other')).toBe('https://app.x.in/p/abc')
    expect(absolutePortalUrl('/p/abc', 'https://app.x.in/')).toBe('https://app.x.in/p/abc')
  })
})
