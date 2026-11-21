import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from '@ipc/contracts'

/**
 * A server that takes the connection and never answers used to keep the app
 * on its loading shell forever. Every request now gives up, and says so.
 */

// A fetch that never answers, but stops when its signal aborts -- as the real one does.
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }),
  )
}

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('requests that never answer', () => {
  it('callApi gives up with a plain message', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const { callApi, TIMEOUT_MESSAGE } = await import('./client')
    const call = callApi('/auth/session', { responseSchema: z.object({}) })
    const settled = expect(call).rejects.toMatchObject({ status: 0, message: TIMEOUT_MESSAGE })
    await vi.advanceTimersByTimeAsync(30_000)
    await settled
  })

  it('a longer limit is honoured', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const { callApi, SLOW_TIMEOUT_MS } = await import('./client')
    let done = false
    const call = callApi('/crm/imports/commit', { method: 'POST', body: {}, responseSchema: z.object({}), timeoutMs: SLOW_TIMEOUT_MS })
    call.catch(() => (done = true))
    await vi.advanceTimersByTimeAsync(31_000)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(SLOW_TIMEOUT_MS)
    expect(done).toBe(true)
  })

  it('a hung refresh returns false and keeps the stored session', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    localStorage.setItem('ipc_refresh_token', 'r1')
    const { rotateTokens, hasStoredSession } = await import('./client')
    const r = rotateTokens()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await r).toBe(false)
    expect(hasStoredSession()).toBe(true)
  })
})

describe('two tabs refreshing at once (0221)', () => {
  const pair = (a: string, r: string) =>
    new Response(JSON.stringify({ access_token: a, refresh_token: r, token_type: 'bearer', expires_in: 1800 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  it('the tab that loses waits for the winner, then carries on signed in', async () => {
    localStorage.setItem('ipc_refresh_token', 'old')
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string }
        seen.push(body.refresh_token ?? '')
        if (body.refresh_token === 'old') {
          // The other tab won this race and stores its new token a moment later.
          setTimeout(() => localStorage.setItem('ipc_refresh_token', 'winner'), 200)
          return new Response('{}', { status: 409 })
        }
        return pair('access-2', 'next')
      }),
    )
    const { rotateTokens } = await import('./client')
    const done = rotateTokens()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await done).toBe(true)
    expect(seen).toEqual(['old', 'winner'])
    expect(localStorage.getItem('ipc_refresh_token')).toBe('next')
  })

  it('a refused session (401) still signs out', async () => {
    localStorage.setItem('ipc_refresh_token', 'gone')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const { rotateTokens } = await import('./client')
    expect(await rotateTokens()).toBe(false)
    expect(localStorage.getItem('ipc_refresh_token')).toBeNull()
  })
})

describe('a new tab is one round trip from drawing', () => {
  const session = {
    user_id: '00000000-0000-4000-8000-000000000001',
    company_id: '00000000-0000-4000-8000-000000000002',
    role: 'admin',
    is_owner: true,
    display_name: 'Asha',
    email: 'asha@example.com',
    plan_gate: 'active',
    plan_expiry: null,
    permissions: ['crm.view'],
  }

  it('the first call gets a token first, and the session rides on that refresh', async () => {
    localStorage.setItem('ipc_refresh_token', 'r1')
    const calls: { url: string; auth: string | null }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        calls.push({ url, auth: headers.Authorization ?? null })
        if (url.includes('/auth/refresh')) {
          return new Response(
            JSON.stringify({ access_token: 'a1', refresh_token: 'r2', token_type: 'bearer', expires_in: 1800, session }),
            { status: 200 },
          )
        }
        return new Response('{"ok":true}', { status: 200 })
      }),
    )
    const { callApi, takeRefreshedSession } = await import('./client')
    // Two pages asking at once share one refresh: a refresh token is single-use.
    await Promise.all([
      callApi('/crm/leads/summary', { responseSchema: z.object({ ok: z.boolean() }) }),
      callApi('/dashboard/summary', { responseSchema: z.object({ ok: z.boolean() }) }),
    ])
    const refreshes = calls.filter((c) => c.url.includes('/auth/refresh'))
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0]!.url).toContain('?with=session')
    expect(calls.filter((c) => !c.url.includes('/auth/refresh')).every((c) => c.auth === 'Bearer a1')).toBe(true)
    expect(takeRefreshedSession()?.display_name).toBe('Asha')
    // Handed over once.
    expect(takeRefreshedSession()).toBeNull()
  })

  it('an API without the session still refreshes', async () => {
    localStorage.setItem('ipc_refresh_token', 'r1')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ access_token: 'a1', refresh_token: 'r2', token_type: 'bearer', expires_in: 1800 }), { status: 200 })),
    )
    const { rotateTokens, takeRefreshedSession } = await import('./client')
    expect(await rotateTokens(true, true)).toBe(true)
    expect(takeRefreshedSession()).toBeNull()
  })
})

describe('which writes re-read the profit figures', () => {
  it('money, crew pay, payroll and a project or its shoots; not a task or a lead', async () => {
    const { MONEY_WRITE } = await import('./client')
    for (const p of ['/billing/payments', '/financials/expenses/1', '/allocation/abc/cost', '/team-payouts/slot/1/pay', '/payroll/run', '/projects/1', '/shoots?x=1']) {
      expect(MONEY_WRITE.test(p), p).toBe(true)
    }
    for (const p of ['/tasks/1', '/crm/leads/1', '/notifications/read', '/projectsx', '/me/payouts']) {
      expect(MONEY_WRITE.test(p), p).toBe(false)
    }
  })
})
