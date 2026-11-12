import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { fail } from '../middleware/errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Route params reach Postgres as uuids; a malformed one is a miss (404), never
 * a 500 from a cast error. Also narrows the type: Hono hands back
 * `string | undefined` for any param name.
 */
export function uuidParam(c: Context<AppEnv>, key = 'id'): string {
  const v = c.req.param(key)
  if (!v || !UUID_RE.test(v)) fail(404, 'We could not find that record.')
  return v
}

/** A YYYY-MM-DD path segment. */
export function dateParam(c: Context<AppEnv>, key = 'date'): string {
  const v = c.req.param(key)
  if (!v || !DATE_RE.test(v)) fail(422, 'Invalid date.')
  return v
}

/** An opaque token or key segment: present and bounded, nothing more. */
export function textParam(c: Context<AppEnv>, key: string, max = 200): string {
  const v = c.req.param(key)
  if (!v || v.length > max) fail(404, 'We could not find that record.')
  return v
}

/**
 * An optional uuid query filter. A malformed value is the caller's mistake
 * (422), not a missing row — and never a cast error from Postgres.
 */
export function uuidQuery(c: Context<AppEnv>, key: string): string | null {
  const v = c.req.query(key)
  if (!v) return null
  if (!UUID_RE.test(v)) fail(422, 'That filter is not a valid id.')
  return v
}

/**
 * An optional YYYY-MM-DD query filter (a window on a date column). A value
 * that is not a real calendar date is the caller's mistake (422), never a
 * cast error from Postgres.
 */
export function dateQuery(c: Context<AppEnv>, key: string): string | null {
  const v = c.req.query(key)
  if (!v) return null
  const d = new Date(`${v}T00:00:00Z`)
  if (!DATE_RE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    fail(422, 'That date filter is not a valid date.')
  }
  return v
}

/**
 * An optional search box's words: trimmed, bounded, and null when blank.
 * Used in an ILIKE, so pass it through `likePattern` first.
 */
export function searchQuery(c: Context<AppEnv>, key = 'q', max = 100): string | null {
  const v = c.req.query(key)?.trim()
  if (!v) return null
  return v.slice(0, max)
}

/** `%words%` for ILIKE, with the user's own % _ and \ taken literally. */
export const likePattern = (v: string) => `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

/**
 * An optional numeric query filter, absent when the caller did not send one.
 *
 * `Number('')` is 0, not NaN. Reading a missing `max_amount` that way turned
 * the company-expenses list into `amount <= 0` and it returned nothing, for
 * every studio, for as long as the filter existed — while the summary tiles
 * above it counted the same rows correctly. A blank or unparseable value is
 * "no filter"; an explicit 0 still means 0.
 */
export function numberQuery(c: Context<AppEnv>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = c.req.query(key)
    if (v === undefined || v.trim() === '') continue
    const n = Number(v)
    if (!Number.isFinite(n)) fail(422, 'That filter is not a valid number.')
    return n
  }
  return null
}
