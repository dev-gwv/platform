/**
 * Sentry, initialised before anything else.
 *
 * This module MUST be the first import in `server.ts`. The SDK instruments
 * modules by patching them as they load (http, postgres, hono), so anything
 * imported ahead of it is instrumented too late and its spans never appear.
 * ES module evaluation runs in import order, so `import './instrument'` on
 * line one is enough — but only on line one.
 *
 * Nothing here throws. A missing or malformed DSN disables Sentry and leaves
 * the structured log untouched: observability must never be the reason the
 * API fails to boot.
 */
import * as Sentry from '@sentry/bun'

/**
 * 0 disables tracing. Anything outside 0..1 is treated as "not set".
 *
 * The empty-string check is not defensive padding: `Number('')` is 0, and
 * `SENTRY_TRACES_SAMPLE_RATE=` with nothing after it is exactly what ships in
 * .env.example. Without this line an unset variable means "trace nothing"
 * instead of "use the default", and the symptom is a Sentry project with
 * errors but no performance data and no obvious reason why.
 */
export function sampleRate(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim()
  if (!trimmed) return fallback
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback
}

/**
 * Last line of defence before an event leaves the building.
 *
 * The tags and contexts we set are ours, but a stack trace or an error message
 * can still carry a connection string or a token — postgres.js puts the DSN in
 * its connection errors, and an auth failure can echo the token it was handed.
 * Redact the two shapes that actually occur here rather than trying to be
 * clever about every secret that could theoretically appear.
 *
 * Exported so it can be tested without booting the SDK: a regression here
 * leaks credentials to a third party, and that is not something to find out
 * from a Sentry issue.
 */
export function scrubSensitive(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
}

const dsn = process.env['SENTRY_DSN']?.trim()
const environment = process.env['ENVIRONMENT']?.trim() || 'unknown'
// Falls back to 'dev' the same way /health does, so a release that says "dev"
// in Sentry means exactly what it means there: APP_VERSION was not set.
const release = process.env['APP_VERSION']?.trim() || 'dev'

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,

    // Tracing. 0.1 in production is the usual starting point: enough to see
    // which endpoints are slow, cheap enough not to think about the bill.
    // Raise it temporarily when chasing something specific.
    tracesSampleRate: sampleRate(
      process.env['SENTRY_TRACES_SAMPLE_RATE'],
      environment === 'production' ? 0.1 : 1,
    ),

    // OFF, deliberately. This is a multi-tenant product: `sendDefaultPii`
    // would attach request headers, cookies and bodies to every event, which
    // for this API means client phone numbers, addresses and auth tokens
    // leaving the VPS. What Sentry needs to be useful is WHICH user and WHICH
    // studio, and those are attached explicitly in the auth middleware.
    sendDefaultPii: false,

    integrations: [
      // Route names and timings for Hono. Deprecated in favour of the
      // @sentry/hono package, which is still ALPHA — this is the stable path
      // and the swap is a small one when that package settles.
      Sentry.honoIntegration(),
      // Spans for postgres.js, so a slow endpoint shows WHICH query was slow
      // rather than just that the handler took two seconds.
      Sentry.postgresJsIntegration(),
      // Zod failures arrive as one flat "invalid input" without this; with it,
      // the offending field names are on the event.
      Sentry.zodErrorsIntegration(),
      // Non-Error throws (objects, strings) keep their properties instead of
      // arriving as "[object Object]".
      Sentry.extraErrorDataIntegration(),
    ],

    beforeSend(event) {
      if (event.message) event.message = scrubSensitive(event.message)
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrubSensitive(ex.value)
      }
      return event
    },
  })

  Sentry.setTag('service', 'ipc-api')
}
