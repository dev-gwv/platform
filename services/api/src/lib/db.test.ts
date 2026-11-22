import { describe, expect, it } from 'vitest'
import { connectionSettings, pgText, pgTypes } from './db'

/**
 * Regression test for the production outage where every endpoint with a
 * numeric query param (LIMIT on /settings/audit, /cron/runs, /crm/leads…)
 * crashed with `ERR_INVALID_ARG_TYPE ... Received type number`.
 *
 * postgres.js feeds each `serialize` return into `Buffer.byteLength` when
 * building the Bind message, so serializers must return strings. The old
 * identity serializers returned numbers/Dates unchanged and only string-only
 * endpoints kept working — which is why no gate caught it.
 */
describe('pgTypes serializers always return strings', () => {
  it.each([
    ['numeric', 51],
    ['numeric', 0],
    ['numeric', 141600.5],
    ['int8', 42],
    ['date', '2026-09-06'],
    ['timestamptz', '2026-09-06T10:00:00.000Z'],
    ['timestamptz', new Date('2026-09-06T10:00:00.000Z')],
  ] as const)('%s serializes %s to a string', (kind, value) => {
    expect(typeof pgTypes[kind].serialize(value)).toBe('string')
  })

  it('serializes numbers the way postgres text format expects', () => {
    expect(pgTypes.numeric.serialize(51)).toBe('51')
    expect(pgTypes.int8.serialize(42)).toBe('42')
  })

  it('serializes Date objects to ISO strings', () => {
    expect(pgTypes.timestamptz.serialize(new Date('2026-09-06T10:00:00.000Z'))).toBe(
      '2026-09-06T10:00:00.000Z',
    )
  })

  it('pgText passes strings through and stringifies the rest', () => {
    expect(pgText('hello')).toBe('hello')
    expect(pgText(51)).toBe('51')
    expect(pgText(true)).toBe('true')
  })
})

describe('connection settings', () => {
  // JIT compiling cost 1.3-2.8 s on each report query of a 1,000-project
  // studio (Financials waited 5.5 s; the P&L 1.7 s, 39 ms without it).
  it('turns the JIT compiler off for every pooled connection', () => {
    expect(connectionSettings.jit).toBe('off')
  })
})
