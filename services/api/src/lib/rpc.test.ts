import { describe, expect, it } from 'vitest'
import { rpcJson } from './rpc'

/**
 * Every dashboard backed by a jsonb-returning RPC -- GST, reminders,
 * personal expenses, the attendance streak -- ran JSON.parse() over a value
 * postgres.js had already decoded into an object. In production that surfaced
 * as `JSON Parse error: Unexpected identifier "object"` on every request,
 * because JSON.parse stringifies its argument first and gets "[object Object]".
 *
 * Nothing caught it because no test called those handlers.
 */
describe('rpcJson()', () => {
  it('passes through the object postgres.js already decoded', () => {
    const decoded = { score_card: { net_profit: -3000 }, items: [1, 2] }
    expect(rpcJson(decoded, {})).toEqual(decoded)
  })

  it('is exactly the case that used to throw', () => {
    const decoded = { ok: true }
    // What the routers did before: coerces to "[object Object]", then fails.
    expect(() => JSON.parse(decoded as unknown as string)).toThrow()
    expect(rpcJson(decoded, {})).toEqual(decoded)
  })

  it('still parses a string, so it does not depend on driver configuration', () => {
    expect(rpcJson('{"streak":4}', { streak: 0 })).toEqual({ streak: 4 })
  })

  it('falls back on null and undefined, which is how an empty studio reads', () => {
    const empty = { items: [], summary: { total_count: 0 } }
    expect(rpcJson(null, empty)).toBe(empty)
    expect(rpcJson(undefined, empty)).toBe(empty)
  })

  it('keeps a legitimately falsy payload instead of swapping in the fallback', () => {
    expect(rpcJson(0, 99)).toBe(0)
    expect(rpcJson(false, true)).toBe(false)
  })
})
