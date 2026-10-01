import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { HitStore, rateLimit, securityHeaders, slidingWindow } from './security'
import { resolveClientIp } from '../lib/client-ip'

describe('slidingWindow rate limit', () => {
  it('allows up to the limit within the window', () => {
    let hits: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = slidingWindow(hits, 1000 + i, 10_000, 3)
      expect(r.allowed).toBe(true)
      hits = r.next
    }
    // 4th hit in the window is blocked.
    expect(slidingWindow(hits, 1003, 10_000, 3).allowed).toBe(false)
  })

  it('forgets hits older than the window', () => {
    const old = [1, 2, 3] // long ago
    const r = slidingWindow(old, 1_000_000, 10_000, 3)
    expect(r.allowed).toBe(true)
    expect(r.next).toEqual([1_000_000]) // old ones pruned
  })
})

describe('HitStore stays bounded', () => {
  it('sweeps keys whose window has fully elapsed', () => {
    const store = new HitStore(1000, 4)
    store.hit('a', 1000, 100, 5)
    store.hit('b', 1000, 100, 5)
    store.hit('c', 1000, 100, 5)
    // The fourth op runs the sweep at t=5000: every earlier key is stale.
    store.hit('d', 5000, 100, 5)
    expect(store.size).toBe(1)
  })

  it('evicts the least recently used keys past capacity', () => {
    const store = new HitStore(3, 1_000_000)
    store.hit('a', 1, 100, 5)
    store.hit('b', 2, 100, 5)
    store.hit('c', 3, 100, 5)
    store.hit('a', 4, 100, 5) // touch a: now b is the oldest
    store.hit('d', 5, 100, 5)
    expect(store.size).toBe(3)
    // b was evicted; a, c, d remain and their windows survive.
    expect(store.hit('b', 6, 100, 1).allowed).toBe(true) // fresh key, fresh window
    expect(store.hit('a', 7, 100, 2).allowed).toBe(false) // a already has 2 hits
  })
})

describe('resolveClientIp', () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n] ?? h[n.toLowerCase()] })

  it('takes the LAST hop of X-Forwarded-For — the one our proxy appended', () => {
    expect(resolveClientIp(headers({ 'X-Forwarded-For': '1.1.1.1, 203.0.113.9' }), undefined)).toBe('203.0.113.9')
  })

  it('ignores a client-supplied CF-Connecting-IP unless configured to trust it', () => {
    const h = headers({ 'CF-Connecting-IP': '9.9.9.9', 'X-Forwarded-For': '203.0.113.9' })
    expect(resolveClientIp(h, undefined)).toBe('203.0.113.9')
    expect(resolveClientIp(h, 'CF-Connecting-IP')).toBe('9.9.9.9')
  })

  it('falls back to a shared bucket when nothing is present', () => {
    expect(resolveClientIp(headers({}), undefined)).toBe('unknown')
  })
})

describe('rateLimit middleware', () => {
  const env = { CLIENT_IP_HEADER: 'X-Forwarded-For' } as AppEnv['Bindings']
  const build = (scope: 'ip' | 'ip+path') => {
    const app = new Hono<AppEnv>()
    const store = new HitStore()
    app.use('/auth/*', rateLimit({ windowMs: 60_000, limit: 2, scope, store }))
    app.get('/auth/a', (c) => c.json({ ok: true }))
    app.get('/auth/b', (c) => c.json({ ok: true }))
    return app
  }
  const from = (ip: string) => ({ headers: { 'X-Forwarded-For': ip } })

  it('scope ip shares one bucket across paths; a spoofed first hop does not escape it', async () => {
    const app = build('ip')
    expect((await app.request('/auth/a', from('10.0.0.1'), env)).status).toBe(200)
    expect((await app.request('/auth/b', from('10.0.0.1'), env)).status).toBe(200)
    const blocked = await app.request('/auth/a', from('10.0.0.1'), env)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('60')
    // Prepending a fake address does not change the last hop.
    expect((await app.request('/auth/a', from('8.8.8.8, 10.0.0.1'), env)).status).toBe(429)
    // A different real address has its own bucket.
    expect((await app.request('/auth/a', from('10.0.0.2'), env)).status).toBe(200)
  })

  it('scope ip+path keeps paths apart', async () => {
    const app = build('ip+path')
    expect((await app.request('/auth/a', from('10.0.0.1'), env)).status).toBe(200)
    expect((await app.request('/auth/a', from('10.0.0.1'), env)).status).toBe(200)
    expect((await app.request('/auth/a', from('10.0.0.1'), env)).status).toBe(429)
    expect((await app.request('/auth/b', from('10.0.0.1'), env)).status).toBe(200)
  })
})

describe('securityHeaders', () => {
  it('lands on a raw Response the handler built itself', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', securityHeaders)
    app.get('/raw', () => new Response('plain', { status: 200 }))
    const res = await app.request('/raw')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
  })

  it('keeps the resource policy a handler set, so a public logo can show on the app origin', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', securityHeaders)
    app.get('/logo', () => new Response('png', { headers: { 'Cross-Origin-Resource-Policy': 'cross-origin' } }))
    const res = await app.request('/logo')
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })
})
