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
