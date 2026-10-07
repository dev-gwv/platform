import { afterEach, describe, expect, it, vi } from 'vitest'
import { firebasePasswordOk } from './legacy-login'

afterEach(() => vi.unstubAllGlobals())

describe("an old app's password, checked with Firebase once", () => {
  it('is accepted only when Firebase signs the person in', async () => {
    const fetchOk = vi.fn(async () => new Response(JSON.stringify({ idToken: 'x' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchOk)
    expect(await firebasePasswordOk('key', 'a@b.in', 'right')).toBe(true)
    const [url, init] = fetchOk.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('accounts:signInWithPassword?key=key')
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.in', password: 'right', returnSecureToken: false })
  })

  it('says no to a wrong password, a Firebase outage, or no key at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }), { status: 400 })))
    expect(await firebasePasswordOk('key', 'a@b.in', 'wrong')).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed') }))
    expect(await firebasePasswordOk('key', 'a@b.in', 'any')).toBe(false)
    const never = vi.fn()
    vi.stubGlobal('fetch', never)
    expect(await firebasePasswordOk('', 'a@b.in', 'any')).toBe(false)
    expect(never).not.toHaveBeenCalled()
  })
})
