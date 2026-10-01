import { describe, expect, it } from 'vitest'
import { lastSeenText, loginMessage, namesText, noteDue } from './assign-note'

describe('the note after assigning work', () => {
  it('shows for the first six assignments, then stops', () => {
    expect(noteDue(undefined)).toBe(true)
    expect(noteDue({ shown: 5, closed: false })).toBe(true)
    expect(noteDue({ shown: 6, closed: false })).toBe(false)
  })

  it('stops for good once closed', () => {
    expect(noteDue({ shown: 1, closed: true })).toBe(false)
  })

  it('says when the member last opened the app, in plain words', () => {
    const now = new Date('2026-09-30T15:00:00')
    expect(lastSeenText(null, now)).toBe('has not opened the app yet')
    expect(lastSeenText('2026-09-30T09:00:00', now)).toBe('opened the app today')
    expect(lastSeenText('2026-09-29T23:00:00', now)).toBe('last opened the app yesterday')
    expect(lastSeenText('2026-09-27T10:00:00', now)).toBe('last opened the app 3 days ago')
    expect(lastSeenText('2026-01-01T10:00:00', now)).toBe('has not opened the app for a while')
  })

  it('names people by first name, shortening long lists', () => {
    expect(namesText(['Nitin Kumar'])).toBe('Nitin')
    expect(namesText(['Nitin Kumar', 'Priya Shah'])).toBe('Nitin and Priya')
    expect(namesText(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others')
  })

  it('writes a login message with no password or reset link in it', () => {
    const text = loginMessage({ name: 'Nitin Kumar', studio: 'Mulberry', email: 'nitin@example.com', loginUrl: 'https://app.test/login' })
    expect(text).toContain('Hi Nitin,')
    expect(text).toContain('https://app.test/login with nitin@example.com')
    expect(text).toContain('the password we gave you')
    expect(text).toContain('My profile')
    expect(text).not.toMatch(/token=|reset-password/)
    expect(loginMessage({ name: 'Ravi', studio: 'Mulberry', email: null, loginUrl: 'https://app.test/login' })).toContain('Ask us for your login details')
  })
})
