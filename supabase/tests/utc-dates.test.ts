import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

/**
 * Dates the API sends must parse in a browser whatever the server's time zone.
 * The live database runs in UTC, where `to_char(..., 'OF')` gives "+00", which
 * `new Date()` cannot read ("Invalid time value" crashed a page on 19 Oct).
 * Every such date is written `to_char(x at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.
 */
describe('dates sent to the browser', () => {
  it('reads the same in a UTC database as anywhere else', async () => {
    const db = new PGlite()
    await db.exec("set timezone to 'UTC'")
    const { rows } = await db.query<{ d: string }>("select to_char(timestamptz '2026-10-19 17:50:40+05:30' at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as d")
    expect(rows[0]!.d).toBe('2026-10-19T12:20:40Z')
    expect(Number.isNaN(Date.parse(rows[0]!.d))).toBe(false)
    // What the old format gave on the live server:
    expect(Number.isNaN(new Date('2026-10-19T12:20:40+00').getTime())).toBe(true)
  })
})
