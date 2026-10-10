import postgres, { type Sql, type TransactionSql } from 'postgres'
import type { Env } from '../context'

/**
 * The Postgres client (replaces supabase-js / PostgREST). One pooled connection
 * per process; the API connects as the `authenticator` role and SET ROLEs per
 * request, mirroring PostgREST so every RLS policy + SECURITY DEFINER function
 * behaves identically to the Supabase setup.
 */
let _sql: Sql | null = null

const ident = (v: unknown): unknown => v

/**
 * postgres.js feeds every `serialize` return straight into
 * `Buffer.byteLength` when building the Bind message, so a serializer MUST
 * return a string. Returning the input unchanged (e.g. a number for LIMIT)
 * crashes with `ERR_INVALID_ARG_TYPE ... Received type number` — and because
 * only numeric/date params take this path, every string-only endpoint keeps
 * working, which is exactly how this hid from all gates until production.
 */
export function pgText(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v)
}

/**
 * PostgREST returned JSON, so the zod contracts expect ISO timestamp strings,
 * "YYYY-MM-DD" dates, and JSON numbers. postgres.js instead yields Date objects
 * and numeric-as-string. These read-side parsers realign the wire shape to what
 * the contracts already validate, centrally — so no query or contract changes.
 */
function pgTimestampToIso(v: string): string {
  // "2026-06-01 10:00:00.123+00" -> "2026-06-01T10:00:00.123+00:00"
  let s = v.replace(' ', 'T')
  const m = s.match(/([+-]\d{2})(\d{2})?$/)
  if (m && m.index !== undefined) s = s.slice(0, m.index) + m[1] + ':' + (m[2] ?? '00')
  return s
}

export const pgTypes = {
  // numeric/decimal -> Number (money contracts are z.number()).
  numeric: { to: 1700, from: [1700], serialize: pgText, parse: (v: string) => Number(v) },
  // int8/bigint -> Number (counts).
  int8: { to: 20, from: [20], serialize: pgText, parse: (v: string) => Number(v) },
  // date -> "YYYY-MM-DD" string (isoDate), not a Date object.
  date: { to: 1082, from: [1082], serialize: pgText, parse: ident },
  // timestamp(tz) -> ISO-8601 string with offset (isoDateTime).
  timestamptz: { to: 1184, from: [1114, 1184], serialize: pgText, parse: pgTimestampToIso },
}

const TYPES = pgTypes

export function db(env: Env): Sql {
  if (!_sql) {
    _sql = postgres(env.DATABASE_URL, {
      max: 10,
      // Function-heavy workload with dynamic SQL; skip the prepared-statement
      // cache to avoid plan-cache surprises across SET ROLE boundaries.
      prepare: false,
      types: TYPES,
    })
  }
  return _sql
}

/**
 * Run `fn` as the `authenticated` role with `auth.uid()` bound to `uid`, inside
 * one transaction. This is the RLS-scoped path — the equivalent of supabase-js's
 * anon-key-plus-JWT client. Every tenant read/write goes through here.
 */
export function withUser<T>(env: Env, uid: string, fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
  return db(env).begin(async (sql) => {
    // set_config(..., true) = local to this transaction; auth.uid() reads it.
    await sql`select set_config('request.jwt.claim.sub', ${uid}, true)`
    await sql`set local role authenticated`
    return fn(sql)
  }) as Promise<T>
}

/**
 * Run `fn` as `service_role` (BYPASSRLS) — the narrow escape hatch for payments,
 * webhooks, cron, and cross-tenant platform ops. Never expose to a tenant path.
 */
export function withService<T>(env: Env, fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
  return db(env).begin(async (sql) => {
    await sql`set local role service_role`
    return fn(sql)
  }) as Promise<T>
}
