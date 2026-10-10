import { Hono } from 'hono'
import { clientErrorAck, clientErrorReport } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { describeError, log } from '../../lib/log'

const STARTED_AT = Date.now()
const PROBE_TIMEOUT_MS = 2_000

/**
 * Public liveness + readiness. Proves the process and routing are up, and
 * probes the database best-effort with a hard timeout. Nothing here names the
 * environment or repeats a driver's error text: this is reachable by anyone,
 * and "connection refused to db:5432 as authenticator" is a map for them.
 */
interface HealthBody {
  ok: boolean
  service: 'ipc-api'
  version: string
  uptime_s: number
  db: 'ok' | 'unreachable' | 'not_configured'
  db_latency_ms: number | null
}

export const healthRouter = new Hono<AppEnv>().get('/', async (c) => {
  let db: HealthBody['db'] = 'not_configured'
  let latency: number | null = null
  if (c.env.DATABASE_URL) {
    const started = Date.now()
    try {
      const { db: getDb } = await import('../../lib/db')
      await Promise.race([
        getDb(c.env)`select 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS)),
      ])
      db = 'ok'
      latency = Date.now() - started
    } catch (e) {
      db = 'unreachable'
      log.warn({ ...describeError(e), path: '/health' }, 'health probe failed')
    }
  }
  const body: HealthBody = {
    ok: db !== 'unreachable',
    service: 'ipc-api',
    version: c.env.APP_VERSION || 'dev',
    uptime_s: Math.round((Date.now() - STARTED_AT) / 1000),
    db,
    db_latency_ms: latency,
  }
  return c.json(body, db === 'unreachable' ? 503 : 200)
})

/**
 * Crash reports from the web app. Deliberately unauthenticated — a broken
 * session must still be reportable — and deliberately useless to abuse: tiny
 * schema, the /health rate limit, nothing stored, just a log line the
 * request id ties to anything else that happened around it.
 */
healthRouter.post('/client-errors', async (c) => {
  const parsed = clientErrorReport.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) fail(422, 'Invalid report.')
  log.warn(
    {
      kind: parsed.data.kind,
      clientMessage: parsed.data.message,
      clientStack: parsed.data.stack,
      clientUrl: parsed.data.url,
      userAgent: c.req.header('User-Agent') ?? null,
    },
    'client error',
  )
  return c.json(clientErrorAck.parse({ ok: true }))
})
