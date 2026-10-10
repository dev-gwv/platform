import * as Sentry from '@sentry/bun'
import type { Env } from '../context'
import { describeError, log } from './log'

/**
 * Where an unexpected failure goes.
 *
 * Every call site is `attempt()` or the error middleware, and both pass the
 * same context, so this stays the one place that decides what reaching Sentry
 * looks like. The signature has not changed since this posted Sentry events
 * by hand over fetch — the SDK replaced the envelope, not the contract.
 *
 * What the SDK adds over the hand-rolled version: a real stack trace with
 * frames (so events group by where they broke rather than all landing in one
 * bucket), the surrounding trace and its DB spans, breadcrumbs, and the user
 * and studio set by the auth middleware.
 *
 * `init` lives in `instrument.ts` and reads the same process env, so an unset
 * SENTRY_DSN makes `captureException` a no-op. The structured log line is
 * written by the caller either way, which is what keeps a bench with no DSN
 * exactly as debuggable as it was.
 */
interface ReportContext {
  requestId: string
  method: string
  path: string
  label?: string
  environment?: string
  release?: string
}

/** Fire-and-forget. Never throws, never awaited on the request path. */
export function reportError(
  _env: Pick<Env, 'SENTRY_DSN' | 'ENVIRONMENT' | 'APP_VERSION'>,
  err: unknown,
  ctx: ReportContext,
): void {
  try {
    const d = describeError(err)
    Sentry.withScope((scope) => {
      scope.setTag('request_id', ctx.requestId)
      scope.setTag('method', ctx.method)
      // The operation name from attempt(), e.g. 'crm.merge'. This is the tag
      // worth grouping and alerting on: it names what the studio was doing.
      scope.setTag('label', ctx.label ?? 'unlabelled')
      // Postgres SQLSTATE. '42501' is an RLS refusal and usually a permission
      // bug; '23505' is a duplicate and usually a user retrying. Being able to
      // split those two apart in the issue list is the difference between a
      // useful alert and a noisy one.
      scope.setTag('pg_code', d.code ?? 'none')
      scope.setContext('request', { path: ctx.path, method: ctx.method, requestId: ctx.requestId })
      // An Error keeps its stack; anything else would otherwise arrive as
      // "[object Object]" with no frames at all.
      Sentry.captureException(err instanceof Error ? err : new Error(d.message))
    })
  } catch (e: unknown) {
    // Reporting must never break the request it is reporting on.
    log.warn({ requestId: ctx.requestId, ...describeError(e) }, 'error report could not be sent')
  }
}
