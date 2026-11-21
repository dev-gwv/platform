import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '@ipc/contracts'
import { SESSION_VIEW_KEY, otherPerson, readSessionView, sameSession, writeSessionView } from './session-snapshot'

const s: SessionState = {
  user_id: '00000000-0000-4000-8000-000000000001',
  company_id: '00000000-0000-4000-8000-000000000002',
  role: 'admin',
  is_owner: true,
  is_platform_admin: false,
  display_name: 'Asha',
  email: 'asha@example.com',
  plan_gate: 'active',
  plan_expiry: null,
  permissions: ['crm.view'],
  studios: [],
  setup_done: true,
  setup_step: null,
  email_verified: true,
} as SessionState

describe('the session kept on the device', () => {
  beforeEach(() => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('comes back as it was kept, and goes on sign-out', () => {
    writeSessionView(s)
    expect(readSessionView()).toEqual(s)
    writeSessionView(null)
    expect(readSessionView()).toBeNull()
  })

  it('is never a token, and its key could not be taken for one', () => {
    writeSessionView(s)
    const raw = localStorage.getItem(SESSION_VIEW_KEY)!
    expect(raw).not.toMatch(/token/i)
    expect(SESSION_VIEW_KEY).not.toMatch(/token|auth/i)
  })

  it('a kept copy that no longer fits the contract is ignored', () => {
    localStorage.setItem(SESSION_VIEW_KEY, '{"user_id":"x"}')
    expect(readSessionView()).toBeNull()
    localStorage.setItem(SESSION_VIEW_KEY, 'not json')
    expect(readSessionView()).toBeNull()
  })

  it('storage that throws never breaks the app', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readSessionView()).toBeNull()
    expect(() => writeSessionView(s)).not.toThrow()
  })

  it('tells a changed session from the same one, and another person from a changed one', () => {
    expect(sameSession(s, { ...s })).toBe(true)
    expect(sameSession(s, { ...s, permissions: [] })).toBe(false)
    expect(otherPerson(s, { ...s, permissions: [] })).toBe(false)
    expect(otherPerson(s, { ...s, company_id: '00000000-0000-4000-8000-000000000009' })).toBe(true)
    expect(otherPerson(null, s)).toBe(false)
  })
})
