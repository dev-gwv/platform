import { Hono } from 'hono'
import { callQueueItem, callQueueScope } from '@ipc/contracts'
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

export const crmCallsRouter = new Hono<AppEnv>()
  .use('/queue', requireAuth, requireModule('crm'))
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
