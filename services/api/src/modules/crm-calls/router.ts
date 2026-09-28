import { Hono } from 'hono'
import { callQueueItem, callQueueScope, dayReport, dayReportRow } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'

/**
 * Today's calls (0201), under /crm. The ranking lives in crm_call_queue so
 * every screen and any future mobile app agree on it. Owners and admins may
 * see the whole studio's list; everyone else sees their own.
 */
const SEES_ALL = new Set(['super_admin', 'admin', 'manager', 'platform_admin'])

const ymd = /^\d{4}-\d{2}-\d{2}$/
/** Today in India unless a day was asked for. */
function dayParam(c: { req: { query(k: string): string | undefined } }): string {
  const d = c.req.query('date')
  if (d && !ymd.test(d)) fail(422, 'Date is YYYY-MM-DD.')
  return d ?? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
}

export const crmCallsRouter = new Hono<AppEnv>()
  .use('/queue', requireAuth, requireModule('crm'))
  .use('/queue/*', requireAuth, requireModule('crm'))

  // "My day": what this caller did today (0205). An owner may ask for anyone's.
  .get('/queue/day', async (c) => {
    const auth = c.get('auth')
    const day = dayParam(c)
    const user = c.req.query('user') || auth.userId
    const rows = await attempt(c, 'crm.day_report', () =>
      withUser(c.env, auth.userId, (sql) => sql`select * from crm_day_report(${user}::uuid, ${day}::date)`),
      { onCode: (code) => (code === '42501' ? ('forbidden' as const) : undefined) },
    )
    if (rows === 'forbidden') fail(403, 'That is someone else\'s day.')
    if (!rows?.[0]) fail(400, 'We could not load your day.')
    return c.json(dayReport.parse(rows[0]))
  })

  // Everyone's day, one row each, for owners and managers.
  .get('/queue/team', async (c) => {
    const auth = c.get('auth')
    if (!SEES_ALL.has(auth.role)) fail(403, 'Only the owner or a manager can see everyone.')
    const day = dayParam(c)
    const rows = await attempt(c, 'crm.day_report_team', () =>
      withUser(c.env, auth.userId, (sql) => sql`select * from crm_day_report_team(${day}::date)`),
    )
    if (!rows) fail(400, 'We could not load the team\'s day.')
    return c.json({ day, items: dayReportRow.array().parse(rows) })
  })

  .get('/queue', async (c) => {
    const auth = c.get('auth')
    const asked = callQueueScope.safeParse(c.req.query('scope') ?? 'mine')
    if (!asked.success) fail(422, 'Scope is mine or all.')
    const scope = asked.data === 'all' && SEES_ALL.has(auth.role) ? 'all' : 'mine'
    const rows = await attempt(c, 'crm.call_queue', () =>
      withUser(c.env, auth.userId, (sql) => sql`select * from crm_call_queue(${scope})`),
    )
    if (!rows) fail(400, 'We could not load your calls.')
    return c.json({ scope, items: callQueueItem.array().parse(rows) })
  })
