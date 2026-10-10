import { Hono } from 'hono'
import {
  createSavedViewRequest,
  createDistributionRequest,
  crmSettings,
  distributionRule,
  idResponse,
  savedView,
  updateCrmSettingsRequest,
  updateDistributionRequest,
  updateSavedViewRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { edit, remove } from './shared'

/** What /crm/settings reads back, shared by the GET and the PATCH. */
type CrmSettingsRow = { sla_hours: number; hot_score: number; assign_strategy: 'least_loaded' | 'round_robin' }

export const crmSettingsRoutes = new Hono<AppEnv>()
  // ── Saved views: mine, plus the ones shared with the studio ─
  // A private view is anyone's to keep; publishing one to the team is an
  // edit on the shared workspace and is gated like one. RLS lets only the
  // creator or the owner change or remove a view.
  .get('/views', async (c) => {
    const rows = await attempt(c, 'crm.views', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select v.id, v.name, v.query, v.visibility, v.user_id, u.name as owner_name, v.created_at
        from crm_saved_views v
        left join users u on u.user_id = v.user_id
        order by (v.visibility = 'private') desc, v.created_at`),
    )
    if (!rows) fail(400, 'We could not load your views.')
    return c.json(savedView.array().parse(rows))
  })

  .post('/views', async (c) => {
    const parsed = createSavedViewRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Name the view.')
    const auth = c.get('auth')
    const v = parsed.data
    if (v.visibility !== 'private' && !auth.access.hasAction('crm', 'edit')) fail(403, 'You cannot publish views to the team.')
    const row = await attempt(
      c,
      'crm.view_save',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const [existing] = await sql<{ id: string }[]>`
            select id from crm_saved_views
            where name = ${v.name} and ((${v.visibility} = 'private' and user_id = ${auth.userId} and visibility = 'private')
                                       or (${v.visibility} <> 'private' and visibility <> 'private'))`
          const rows = existing
            ? await sql`
                update crm_saved_views set query = ${sql.json(v.query)}, visibility = ${v.visibility}
                where id = ${existing.id}
                returning id, name, query, visibility, user_id, created_at`
            : await sql`
                insert into crm_saved_views (company_id, user_id, created_by, name, query, visibility)
                values (get_current_company_id(), ${auth.userId}, ${auth.userId}, ${v.name}, ${sql.json(v.query)}, ${v.visibility})
                returning id, name, query, visibility, user_id, created_at`
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '23505' ? ('taken' as const) : undefined) },
    )
    if (row === 'taken') fail(409, 'A shared view with that name already exists.')
    if (!row) fail(400, 'We could not save this view.')
    const saved = savedView.parse({ ...row, owner_name: null })
    await audit(c, { action: 'view.save', entityType: 'crm_saved_view', entityId: saved.id, after: { name: v.name, visibility: v.visibility } })
    return c.json(saved, 201)
  })

  .patch('/views/:id', async (c) => {
    const parsed = updateSavedViewRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const auth = c.get('auth')
    const v = parsed.data
    if (v.visibility && v.visibility !== 'private' && !auth.access.hasAction('crm', 'edit')) fail(403, 'You cannot publish views to the team.')
    const rows = await attempt(
      c,
      'crm.view_update',
      () =>
        withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`
          update crm_saved_views set ${sql({ ...v, ...(v.query ? { query: sql.json(v.query) } : {}) })} where id = ${id} returning id`),
      { onCode: (code) => (code === '23505' ? ('taken' as const) : undefined) },
    )
    if (rows === 'taken') fail(409, 'A view with that name already exists.')
    if (!rows) fail(400, 'We could not update this view.')
    if (!rows.length) fail(404, 'That view was not found, or it is not yours to change.')
    await audit(c, { action: 'view.update', entityType: 'crm_saved_view', entityId: id, after: v })
    return c.body(null, 204)
  })

  .delete('/views/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.view_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from crm_saved_views where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this view.')
    if (!rows.length) fail(404, 'That view was not found, or it is not yours to remove.')
    await audit(c, { action: 'view.delete', entityType: 'crm_saved_view', entityId: id })
    return c.body(null, 204)
  })

  // ── Settings ────────────────────────────────────────────────
  .get('/settings', async (c) => {
    const rows = await attempt(c, 'crm.settings', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<CrmSettingsRow[]>`
        select crm_sla_hours() as sla_hours,
               coalesce((select s.hot_score from crm_settings s where s.company_id = get_current_company_id()), 60) as hot_score,
               coalesce((select s.assign_strategy from crm_settings s where s.company_id = get_current_company_id()), 'least_loaded') as assign_strategy`),
    )
    if (!rows) fail(400, 'We could not load CRM settings.')
    return c.json(crmSettings.parse(rows[0] ?? { sla_hours: 24, hot_score: 60, assign_strategy: 'least_loaded' }))
  })

  .patch('/settings', edit, async (c) => {
    const parsed = updateCrmSettingsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'The SLA must be between 1 and 720 hours, the hot score between 1 and 1000.')
    if (
      parsed.data.sla_hours === undefined &&
      parsed.data.hot_score === undefined &&
      parsed.data.assign_strategy === undefined
    )
      return c.body(null, 204)
    const auth = c.get('auth')
    if (!auth.isOwner) fail(403, 'Only the studio owner can change CRM settings.')
    const { sla_hours: sla, hot_score: hot, assign_strategy: strategy } = parsed.data
    // crm_set_sla_hours() also moves sla_due_at on every lead still waiting,
    // so a tighter target shows up on the board the same minute.
    const row = await attempt(c, 'crm.settings_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (sla !== undefined) await sql`select crm_set_sla_hours(${sla})`
        if (hot !== undefined) {
          await sql`
            insert into crm_settings (company_id, hot_score) values (get_current_company_id(), ${hot})
            on conflict (company_id) do update set hot_score = excluded.hot_score`
        }
        if (strategy !== undefined) {
          await sql`
            insert into crm_settings (company_id, assign_strategy) values (get_current_company_id(), ${strategy})
            on conflict (company_id) do update set assign_strategy = excluded.assign_strategy`
        }
        const rows = await sql<CrmSettingsRow[]>`
          select crm_sla_hours() as sla_hours,
                 coalesce((select s.hot_score from crm_settings s where s.company_id = get_current_company_id()), 60) as hot_score`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save CRM settings.')
    await audit(c, { action: 'crm.settings_update', entityType: 'crm_settings', entityId: auth.companyId, after: parsed.data })
    return c.json(crmSettings.parse(row))
  })

  // ── Distribution rota ───────────────────────────────────────
  // The rota new leads are shared out on, with what each person is carrying.
  .get('/distribution', async (c) => {
    const rows = await attempt(c, 'crm.distribution', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select r.id, r.user_id, r.priority, r.is_active, u.name as user_name,
                  r.name, r.source_filter, r.strategy, r.last_assigned_at, r.assigned_count,
                  (
                    select count(*) from crm_leads l
                    where l.assigned_to = r.user_id and l.status not in ('converted', 'lost') and l.is_archived = false
                  )::int as lead_count
           from crm_distribution_rules r
           left join users u on u.user_id = r.user_id
           order by r.is_active desc, r.priority, u.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load the distribution rota.')
    return c.json(distributionRule.array().parse(rows))
  })

  .post('/distribution', edit, async (c) => {
    const parsed = createDistributionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a team member.')
    const { user_id, priority, name, source_filter, strategy = 'least_loaded' } = parsed.data
    const row = await attempt(
      c,
      'crm.distribution_add',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [exists] = await sql<{ id: string }[]>`
            select id from crm_distribution_rules where user_id = ${user_id}`
          if (exists) return 'exists' as const
          const [r] = await sql<{ id: string }[]>`
            insert into crm_distribution_rules (company_id, user_id, priority, name, source_filter, strategy)
            select get_current_company_id(), ${user_id}, ${priority}, ${name ?? null},
                   ${sql.array(source_filter ?? [])}::text[], ${strategy}
            where exists (select 1 from users where user_id = ${user_id} and deleted_at is null)
            returning id`
          return r ?? null
        }),
    )
    if (row === 'exists') fail(409, 'They are already on the rota.')
    if (!row) fail(404, 'We could not find that team member.')
    await audit(c, { action: 'distribution.add', entityType: 'crm_distribution_rule', entityId: row.id, after: parsed.data })
    return c.json(idResponse.parse({ id: row.id }), 201)
  })

  .patch('/distribution/:id', edit, async (c) => {
    const parsed = updateDistributionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid distribution patch.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const { source_filter, ...rest } = parsed.data
    const rows = await attempt(c, 'crm.distribution_update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update crm_distribution_rules
             set ${sql({ ...rest, ...(source_filter ? { source_filter: sql.array(source_filter) } : {}) })}
           where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update the rota.')
    if (!rows.length) fail(404, 'Not found.')
    await audit(c, { action: 'distribution.update', entityType: 'crm_distribution_rule', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/distribution/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.distribution_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from crm_distribution_rules where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not remove them from the rota.')
    if (!rows.length) fail(404, 'Not found.')
    await audit(c, { action: 'distribution.remove', entityType: 'crm_distribution_rule', entityId: id })
    return c.body(null, 204)
  })
