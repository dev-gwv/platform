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
