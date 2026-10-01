import { Hono } from 'hono'
import { myFollowUp } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/**
 * A person's own things that live in other people's areas -- today, the CRM
 * follow-ups given to them. Staff without the CRM still get calls to make
 * ("Call Mehta at 4 PM"), and had no way to see them. Read and closed here,
 * scoped to the caller and their studio, without opening the CRM to them.
 *
 * Whose a follow-up is: the person it was given to, else the lead's owner
 * (as the morning email reads it), else whoever wrote it.
 */
export const meRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/follow-ups', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'me.follow_ups', () =>
      withService(c.env, (sql) => sql`
        select a.id, a.lead_id, l.name as lead_name, l.phone as lead_phone,
               a.subject, a.due_at, a.priority
          from crm_activities a
          join crm_leads l on l.id = a.lead_id
         where a.company_id = ${auth.companyId}
           and a.type = 'task' and a.done_at is null and a.due_at is not null
           and coalesce(a.assigned_to, l.assigned_to, a.actor_id) = ${auth.userId}
           and a.due_at < now() + interval '8 days'
           and coalesce(l.is_archived, false) = false
         order by a.due_at
         limit 50`),
    )
    if (!rows) fail(400, 'We could not load your follow-ups.')
    return c.json(myFollowUp.array().parse(rows))
  })

  .post('/follow-ups/:id/done', async (c) => {
    const auth = c.get('auth')
    const id = uuidParam(c)
    const rows = await attempt(c, 'me.follow_up_done', () =>
      withService(c.env, (sql) => sql<{ id: string }[]>`
        update crm_activities a
           set done_at = now()
          from crm_leads l
         where a.id = ${id} and l.id = a.lead_id
           and a.company_id = ${auth.companyId}
           and a.type = 'task' and a.done_at is null
           and coalesce(a.assigned_to, l.assigned_to, a.actor_id) = ${auth.userId}
        returning a.id`),
    )
    if (!rows) fail(400, 'We could not mark that done.')
    if (!rows.length) fail(404, 'That follow-up is not yours, or it is already done.')
    await audit(c, { action: 'activity.update', entityType: 'crm_activity', entityId: id, after: { done: true } })
    return c.json({ ok: true })
  })
