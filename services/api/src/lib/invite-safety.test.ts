import { describe, expect, it } from 'vitest'
import { inviteAcceptPath } from './invite-safety'

describe('inviteAcceptPath', () => {
  it('makes a new login only when the email has none', () => {
    expect(inviteAcceptPath(undefined)).toBe('new')
    expect(inviteAcceptPath(null)).toBe('new')
  })
  it('asks an existing login for its own password', () => {
    expect(inviteAcceptPath({ encrypted_password: '$argon2id$...' })).toBe('check_password')
  })
  it('refuses a login with no password (Google-only, imported, directory entry)', () => {
    expect(inviteAcceptPath({ encrypted_password: null })).toBe('no_password')
    expect(inviteAcceptPath({ encrypted_password: '' })).toBe('no_password')
  })
})
