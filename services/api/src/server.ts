// VPS / container entrypoint (Bun). NOT used on Cloudflare — there the Worker
// runtime imports the default export and supplies `env` (the bindings) itself.
//
// The whole app reads config via `c.env.*`. Hono's fetch takes `env` as its
// second arg and exposes it as `c.env`, so passing `process.env` here makes
// every existing `c.env.SUPABASE_URL` etc. work unchanged — no handler edits.
//
// Excluded from `tsc` typecheck (see tsconfig) because it depends on the Bun
// global rather than @cloudflare/workers-types; Bun runs it directly.
// FIRST import, always: Sentry patches http/postgres/hono as they load, so
// anything imported above this line is instrumented too late to produce spans.
import './instrument'
import app from './index'
import { describeError, log } from './lib/log'
import { missingRequiredEnv } from './lib/startup'

// ── Refuse to start half-configured ──────────────────────────
// In production a missing secret means a container that is "healthy" and
// useless. Exiting makes the deploy's --wait fail loudly instead, while the
// old container (if any) is still the one Traefik routes to.
const missing = missingRequiredEnv(process.env)
if (missing.length > 0) {
  log.error({ missing }, `refusing to start: ${missing.join(', ')} not set (ENVIRONMENT=production)`)
  process.exit(1)
}

// ── Never die of a stray promise ─────────────────────────────
// A rejection nobody awaited (a fire-and-forget bell, a best-effort sync) is a
// bug to log, not a reason to drop every request in flight. An uncaught
// exception leaves the process in an unknown state, so that one is logged and
// the process exits; Docker's restart policy brings a clean one back.
process.on('unhandledRejection', (reason) => {
  log.error({ ...describeError(reason) }, 'unhandled promise rejection')
})
process.on('uncaughtException', (err) => {
  log.error({ ...describeError(err) }, 'uncaught exception, exiting')
  // A moment for the log line (and Sentry's own handler) to get out.
  setTimeout(() => process.exit(1), 500).unref()
})

const port = Number(process.env.PORT ?? 8787)

const server = Bun.serve({
  port,
  idleTimeout: 30,
  fetch: (req) => app.fetch(req, process.env),
})

console.log(`ipc-api listening on :${port}`)

// ── Stop gracefully ──────────────────────────────────────────
// Docker sends SIGTERM on a deploy and SIGKILLs 10 s later. Stop accepting new
// connections and let the requests in flight finish, but exit before Docker
// loses patience so nothing is cut off half-written by the KILL.
const STOP_DEADLINE_MS = 8_000
let stopping = false
function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info({ signal }, 'shutting down')
  setTimeout(() => {
    log.warn({ signal }, 'requests still open at the deadline, exiting anyway')
    process.exit(0)
  }, STOP_DEADLINE_MS).unref()
  void Promise.resolve(server.stop())
    .catch((e: unknown) => log.warn({ ...describeError(e) }, 'server.stop failed'))
    .finally(() => process.exit(0))
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
