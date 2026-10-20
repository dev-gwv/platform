import * as Sentry from '@sentry/react'
import { config } from '../config'

/**
 * Browser-side Sentry.
 *
 * Off unless VITE_SENTRY_DSN is set at build time, which keeps the mock
 * preview and local dev silent without anyone having to remember to turn it
 * off. When it IS on, the beacon in `report.ts` stands down — see main.tsx —
 * because the two would report the same crash twice.
 */
/** Default on: a crash you can watch beats a crash you have to reproduce. */
const REPLAY_ENABLED = (import.meta.env.VITE_SENTRY_REPLAY as string | undefined) !== '0'

export function initSentry(router: unknown): boolean {
  if (!config.sentryDsn) return false

  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.environment,
    release: config.appVersion,

    integrations: [
      // Router-aware tracing: a page-load or navigation span is named after
      // the ROUTE (/projects/$id), not the URL (/projects/8ea3...). Without
      // this every project page is its own transaction and the performance
      // view is thousands of one-off entries instead of one ranked list.
      Sentry.tanstackRouterBrowserTracingIntegration(router),
      // Replays the seconds before a crash. Text and inputs are masked — this
      // is a CRM holding client phone numbers, addresses and money.
      //
      // It is also the expensive part. Measured on this build, gzipped:
      //   no DSN at all ....  7 kB  (the SDK tree-shakes away)
      //   DSN, no replay ... 55 kB
      //   DSN + replay ..... 96 kB
      // so the recorder is ~40 kB. The flag is read from import.meta.env, so
      // setting VITE_SENTRY_REPLAY=0 does not merely skip the integration —
      // Vite folds the constant and the recorder leaves the bundle.
      ...(REPLAY_ENABLED
        ? [Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true })]
        : []),
      // Failed fetch/XHR become their own issues. Otherwise a 500 the UI
      // swallows into a toast never reaches Sentry from this side at all.
      Sentry.httpClientIntegration(),
      // Non-Error throws keep their properties instead of "[object Object]".
      Sentry.extraErrorDataIntegration(),
    ],

    // Slower than the API's default on purpose: a studio's browser makes far
    // fewer transactions than the API serves requests.
    tracesSampleRate: config.environment === 'production' ? 0.2 : 1,

    // Connects the browser transaction to the API's. Scoped to our own API
    // origin so the sentry-trace/baggage headers are never attached to a
    // third-party request.
    tracePropagationTargets: [config.apiBaseUrl],

    // Replay: never sampled on its own, always kept when something broke.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: REPLAY_ENABLED ? 1 : 0,

    sendDefaultPii: false,

    /**
     * Noise the studio cannot act on.
     *
     * Every one of these is a browser or extension artefact rather than a bug
     * in this app, and left in they bury the real issues.
     */
    ignoreErrors: [
      // Cross-origin script errors with no stack — nothing to act on.
      'Script error.',
      // Fires when a user navigates away mid-request. Not a failure.
      'AbortError',
      'The user aborted a request',
      // Chrome extensions and embedded webviews.
      /^ResizeObserver loop/,
      /extension:\/\//,
    ],

    beforeSend(event) {
      // A tab open across a deploy asks for page files the deploy removed.
      // Each missing file used to file its own issue, named after the file
      // ("…follow-ups-Ia-SCERZ.js"), so one deploy looked like a dozen new
      // bugs. They are one thing, and the app reloads itself onto the new
      // release, so they become one warning.
      if (isStaleChunk(event)) {
        event.fingerprint = ['stale-chunk-after-deploy']
        event.level = 'warning'
        event.tags = { ...event.tags, stale_chunk: 'yes' }
      }
      return event
    },
  })

  return true
}

/** What each browser says when a page file is gone (Chrome, Safari, Firefox, a CSS preload). */
export const STALE_CHUNK =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|is not a valid JavaScript MIME type/i

function isStaleChunk(event: Sentry.ErrorEvent): boolean {
  return (event.exception?.values ?? []).some((v) => STALE_CHUNK.test(`${v.type ?? ''}: ${v.value ?? ''}`))
}

/**
 * Who is using the app, attached to every later event.
 *
 * Id only, plus the studio as a tag: enough to answer "is this one studio or
 * everyone" and to find the user's own session, without putting names, emails
 * or phone numbers into a third-party service.
 */
export function setSentryUser(user: { user_id: string; company_id: string; role: string } | null): void {
  if (!config.sentryDsn) return
  if (!user) {
    Sentry.setUser(null)
    return
  }
  Sentry.setUser({ id: user.user_id })
  Sentry.setTag('company_id', user.company_id)
  Sentry.setTag('role', user.role)
}

/**
 * React 19's error hooks, in a shape all three of them accept.
 *
 * React declares these inconsistently: `onUncaughtError` and `onCaughtError`
 * pass `{ componentStack?: string | undefined }`, while `onRecoverableError`
 * passes React's own `ErrorInfo`, whose `componentStack` is `string | null`.
 * Sentry's handler wants `ErrorInfo`. Under `exactOptionalPropertyTypes` none
 * of those three types are assignable to each other, so this accepts the union
 * and normalises to what Sentry declares.
 */
export function reactErrorHandler(): (
  error: unknown,
  errorInfo: { componentStack?: string | null | undefined },
) => void {
  const handle = Sentry.reactErrorHandler()
  return (error, errorInfo) => {
    handle(error, { componentStack: errorInfo.componentStack ?? null })
  }
}
