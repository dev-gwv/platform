import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { clearRefreshCookie, cookieMode, readRefreshCookie, setRefreshCookie } from './session-cookie'

function build() {
  const app = new Hono<AppEnv>()
  app.post('/auth/login', (c) => {
    setRefreshCookie(c, 'raw-refresh-token')
    return c.json({ ok: true })
  })
  app.post('/auth/refresh', (c) => c.json({ cookie: readRefreshCookie(c) }))
  app.post('/auth/logout', (c) => {
    clearRefreshCookie(c)
    return c.json({ ok: true })
  })
  return app
}

describe('refresh cookie mode', () => {
  it('is off unless AUTH_COOKIE=1', () => {
    expect(cookieMode({ AUTH_COOKIE: '' })).toBe(false)
    expect(cookieMode({ AUTH_COOKIE: '1' })).toBe(true)
  })

  it('sets an HttpOnly cookie scoped to /auth and reads it back', async () => {
    const app = build()
    const env = { AUTH_COOKIE: '1', AUTH_COOKIE_SAMESITE: 'lax', ENVIRONMENT: 'test' } as AppEnv['Bindings']
    const res = await app.request('/auth/login', { method: 'POST' }, env)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('ipc_refresh=raw-refresh-token')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/auth')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=7776000')

    const back = await app.request('/auth/refresh', { method: 'POST', headers: { Cookie: 'ipc_refresh=raw-refresh-token' } }, env)
    expect(await back.json()).toEqual({ cookie: 'raw-refresh-token' })
  })

  it('SameSite=None forces Secure, and a domain is applied when configured', async () => {
    const app = build()
    const env = { AUTH_COOKIE: '1', AUTH_COOKIE_SAMESITE: 'none', AUTH_COOKIE_DOMAIN: '.studio.in', ENVIRONMENT: 'test' } as AppEnv['Bindings']
    const res = await app.request('/auth/login', { method: 'POST' }, env)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Domain=.studio.in')
  })

  it('logout clears the cookie', async () => {
    const app = build()
    const env = { AUTH_COOKIE: '1', ENVIRONMENT: 'test' } as AppEnv['Bindings']
    const res = await app.request('/auth/logout', { method: 'POST' }, env)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('ipc_refresh=;')
    expect(cookie).toMatch(/Max-Age=0/)
  })
})
