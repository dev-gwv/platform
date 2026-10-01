import { Hono } from 'hono'
import { usageTrackRequest, z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { studioWork } from '../../lib/scope'

const activityItem = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  user_name: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().uuid().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
})

const activityPage = z.object({
  items: activityItem.array(),
  next_cursor: z.string().nullable(),
})

/**
 * Activity feed: lightweight user action trail.
 * Any authenticated user can read their company's activity.
 */
export const activityRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const rawLimit = Number(c.req.query('limit') ?? 50)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 50
    const cursor = c.req.query('cursor') || null
    if (cursor && Number.isNaN(Date.parse(cursor))) fail(422, 'Invalid cursor.')
    const rawEntityType = c.req.query('entity_type') || null
    const rawUserId = c.req.query('user_id') || null
    if (rawUserId) {
      const uc = z.string().uuid().safeParse(rawUserId)
      if (!uc.success) fail(422, 'Invalid user ID.')
    }
    if (rawEntityType && rawEntityType.length > 40) fail(422, 'Invalid entity_type.')
    const entityType = rawEntityType
    // Staff see their own trail, not the studio's.
    const userId = studioWork(c) ? rawUserId : c.get('auth').userId
    const auth = c.get('auth')

    const rows = await attempt(c, 'activity.list', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql`
          select al.id, al.user_id, u.name as user_name, al.action, al.entity_type, al.entity_id,
                 al.metadata, al.created_at
            from activity_log al
            left join users u on u.user_id = al.user_id
           where al.company_id = ${auth.companyId}
             and (${cursor}::timestamptz is null or al.created_at < ${cursor}::timestamptz)
             and (${entityType}::text is null or al.entity_type = ${entityType})
             and (${userId}::uuid is null or al.user_id = ${userId}::uuid)
           order by al.created_at desc
           limit ${limit + 1}`
      }),
    )

    if (!rows) fail(400, 'We could not load the activity log.')
    const page = rows.slice(0, limit)
    const last = page[page.length - 1] as { created_at?: string } | undefined
    return c.json(
      activityPage.parse({
        items: page,
        next_cursor: rows.length > limit && last?.created_at ? last.created_at : null,
      }),
    )
  })

  .post('/', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const action = typeof body.action === 'string' ? body.action.trim() : ''
    const entityType = typeof body.entity_type === 'string' ? body.entity_type.trim() : ''
    if (!action || !entityType) fail(422, 'action and entity_type are required.')
    if (action.length > 80 || entityType.length > 40) fail(422, 'Invalid action or entity_type.')
    if (body.entity_id != null) {
      const uc = z.string().uuid().safeParse(body.entity_id)
      if (!uc.success) fail(422, 'Invalid entity_id.')
    }

    const auth = c.get('auth')
    const rows = await attempt(c, 'activity.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const meta = body.metadata != null && typeof body.metadata === 'object' ? body.metadata : null
        const made = await sql<{ id: string }[]>`
          insert into activity_log (company_id, user_id, action, entity_type, entity_id, metadata)
          values (${auth.companyId}, ${auth.userId}, ${action}, ${entityType},
                  ${body.entity_id ?? null}::uuid, ${meta ? sql.json(meta as never) : null}::jsonb)
          returning id`
        return made
      }),
    )

    if (!rows?.[0]) fail(400, 'We could not log this activity.')
    return c.json({ id: rows[0].id }, 201)
  })

  // Lovable parity: usage heartbeat (POST /activity/track {route}).
  // Separate table (usage_events), deliberately NOT activity_log: product
  // analytics must never pollute the user-facing audit trail.
  .post('/track', async (c) => {
    const parsed = usageTrackRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'route is required.')
    const auth = c.get('auth')
    const d = parsed.data
    const sessionId = d.session_id?.slice(0, 80) || `srv-${Date.now().toString(36)}`
    const ok = await attempt(c, 'activity.track', () =>
      withUser(c.env, auth.userId, async (sql) => {
        await sql`insert into usage_events
            (company_id, user_id, session_id, route, module, event_name, user_agent, device_type)
          values (${auth.companyId}, ${auth.userId}, ${sessionId},
                  ${d.route.slice(0, 200)}, ${d.module.slice(0, 60)},
                  ${(d.heartbeat ? 'heartbeat' : d.event_name).slice(0, 60)},
                  ${d.user_agent?.slice(0, 400) ?? null}, ${d.device_type?.slice(0, 20) ?? null})`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not record usage.')
    return c.json({ ok: true })
  })
