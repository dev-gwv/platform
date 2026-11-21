import { describe, expect, it } from 'vitest'
import { CACHE_FORMAT, crashAfterRestore, keepQuery, usable } from './persist-cache'

const q = (queryKey: unknown[], status = 'success', data: unknown = [1]) =>
  ({ queryKey, state: { status, data } }) as unknown as Parameters<typeof keepQuery>[0]

describe('pages kept on the device', () => {
  it('keeps what loaded, never sign-in, tokens or the assistant', () => {
    expect(keepQuery(q(['crm', 'leads', 'card']))).toBe(true)
    expect(keepQuery(q(['tasks', 'all'], 'pending', undefined))).toBe(false)
    expect(keepQuery(q(['tasks', 'all'], 'error'))).toBe(false)
    expect(keepQuery(q(['auth', 'session']))).toBe(false)
    expect(keepQuery(q(['assistant', 'state']))).toBe(false)
    expect(keepQuery(q(['calendar', 'link']))).toBe(false)
    expect(keepQuery(q(['crm', 'refresh_token']))).toBe(false)
  })

  it('restores a copy only for the same shapes and within a week', () => {
    const now = Date.parse('2026-11-12T10:00:00Z')
    const stored = { buster: 'abc', savedAt: now - 3600_000, state: { queries: [], mutations: [] } }
    expect(usable(stored, now, 'abc')).toBe(true)
    expect(usable(stored, now, 'def')).toBe(false)
    expect(usable({ ...stored, savedAt: now - 8 * 24 * 3600_000 }, now, 'abc')).toBe(false)
    expect(usable(null, now, 'abc')).toBe(false)
  })

  it('keeps the copy across releases until the format is bumped by hand', () => {
    const now = Date.parse('2026-11-21T10:00:00Z')
    const stored = { buster: CACHE_FORMAT, savedAt: now - 60_000, state: { queries: [], mutations: [] } }
    expect(usable(stored, now, CACHE_FORMAT)).toBe(true)
    expect(usable({ ...stored, buster: 'v1' }, now, CACHE_FORMAT)).toBe(false)
  })

  it('blames a crash on the restored copy only in the first seconds', () => {
    const at = Date.parse('2026-11-21T10:00:00Z')
    expect(crashAfterRestore(at + 2_000, at)).toBe(true)
    expect(crashAfterRestore(at + 20_000, at)).toBe(false)
    expect(crashAfterRestore(at + 2_000, 0)).toBe(false)
  })
})
