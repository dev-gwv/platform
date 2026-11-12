import { describe, expect, it } from 'vitest'
import { daysBetween, welcomeFor } from './welcome'

const base = { isOwner: false, role: 'employee', studioDays: 0, loginDays: 0, studioName: 'Mehta Studios' }

describe('welcomeFor', () => {
  it('points a new owner at the setup videos', () => {
    const w = welcomeFor({ ...base, isOwner: true, role: 'super_admin' })
    expect(w?.kind).toBe('setup')
    expect(w?.link).toBe('/start')
    expect(w?.dedupe).toBe('welcome:setup')
  })
  it('treats an admin like the owner', () => {
    expect(welcomeFor({ ...base, role: 'admin' })?.kind).toBe('setup')
  })
  it('sends nothing to the owner of an older studio', () => {
    expect(welcomeFor({ ...base, isOwner: true, studioDays: 31 })).toBeNull()
  })
  it('points a new team member at their own videos, by studio name', () => {
    const w = welcomeFor(base)
    expect(w?.kind).toBe('team')
    expect(w?.link).toBe('/learn')
    expect(w?.title).toContain('Mehta Studios')
  })
  it('sends nothing to an older team login, even in a new studio', () => {
    expect(welcomeFor({ ...base, loginDays: 40 })).toBeNull()
  })
  it('falls back when the studio has no name', () => {
    expect(welcomeFor({ ...base, studioName: ' ' })?.title).toBe('Welcome! Learn your side in a few short videos')
  })
})

describe('daysBetween', () => {
  it('counts whole days and never goes below zero', () => {
    const now = new Date('2026-11-12T12:00:00Z')
    expect(daysBetween('2026-11-10T13:00:00Z', now)).toBe(1)
    expect(daysBetween('2026-11-13T00:00:00Z', now)).toBe(0)
    expect(daysBetween('nonsense', now)).toBe(0)
  })
})
