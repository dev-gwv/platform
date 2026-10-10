import { Hono } from 'hono'
import {
  cadence,
  cadenceStartResponse,
  createCadenceRequest,
  idResponse,
  leadCadence,
  markCadenceSentRequest,
  startCadenceRequest,
  updateCadenceRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { edit, remove } from './shared'

export const crmCadenceRoutes = new Hono<AppEnv>()
  // ── Cadences ────────────────────────────────────────────────
  .get('/cadences', async (c) => {
    const stageFilter = c.req.query('stage_filter') || null
    const rows = await attempt(c, 'crm.cadences', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select ca.id, ca.name, ca.is_active, ca.created_at,
                  ca.description, ca.stage_filter, ca.source_filter,
                  coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'id', s.id, 'step_no', s.step_no, 'day_offset', s.day_offset,
                      'template_id', s.template_id, 'template_name', t.name, 'note', s.note,
                      'recommended_delay_days', s.recommended_delay_days,
                      'next_stage', s.next_stage, 'next_follow_up_days', s.next_follow_up_days) order by s.step_no)
                    from crm_cadence_steps s left join crm_templates t on t.id = s.template_id
                    where s.cadence_id = ca.id
                  ), '[]'::jsonb) as steps,
                  (select count(*) from crm_lead_cadences lc
                    where lc.cadence_id = ca.id and lc.completed_at is null and lc.stopped_at is null)::int as active_leads
           from crm_cadences ca
           where ${stageFilter ? sql`ca.stage_filter = ${stageFilter}` : sql`true`}
           order by ca.created_at`,
      ),
    )
    if (!rows) fail(400, 'We could not load cadences.')
    return c.json(cadence.array().parse(rows))
  })

  .post('/cadences', edit, async (c) => {
    const parsed = createCadenceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the cadence.')
    const v = parsed.data
    const id = await attempt(c, 'crm.cadence_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [ca] = await sql<{ id: string }[]>`
          insert into crm_cadences (company_id, name, description, stage_filter, source_filter)
          values (get_current_company_id(), ${v.name}, ${v.description ?? null}, ${v.stage_filter ?? null}, ${v.source_filter ?? null})
          returning id`
        if (!ca) return null
        for (const [i, step] of v.steps.entries()) {
          await sql`
            insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, template_id, note,
                                           recommended_delay_days, next_stage, next_follow_up_days)
            values (${ca.id}, get_current_company_id(), ${i + 1}, ${step.day_offset}, ${step.template_id ?? null}, ${step.note ?? null},
                    ${step.recommended_delay_days ?? null}, ${step.next_stage ?? null}, ${step.next_follow_up_days ?? null})`
        }
        return ca.id
      }),
    )
    if (!id) fail(400, 'We could not save this cadence.')
    await audit(c, { action: 'cadence.create', entityType: 'crm_cadence', entityId: id, after: { name: v.name, steps: v.steps.length } })
    return c.json(idResponse.parse({ id }), 201)
  })

  .patch('/cadences/:id', edit, async (c) => {
    const parsed = updateCadenceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.cadence_update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update crm_cadences set ${sql(parsed.data)} where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not update this cadence.')
    if (!rows.length) fail(404, 'That cadence was not found.')
    await audit(c, { action: 'cadence.update', entityType: 'crm_cadence', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/cadences/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.cadence_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from crm_cadences where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this cadence.')
    if (!rows.length) fail(404, 'That cadence was not found.')
    await audit(c, { action: 'cadence.delete', entityType: 'crm_cadence', entityId: id })
    return c.body(null, 204)
  })

  .get('/leads/:id/cadence', async (c) => {
    const leadId = uuidParam(c)
    const rows = await attempt(c, 'crm.lead_cadence', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select lc.cadence_id, ca.name as cadence_name, lc.step_no,
                 (select count(*) from crm_cadence_steps s where s.cadence_id = lc.cadence_id)::int as total_steps,
                 lc.next_at, lc.started_at, lc.completed_at, lc.stopped_at
          from crm_lead_cadences lc join crm_cadences ca on ca.id = lc.cadence_id
          where lc.lead_id = ${leadId}`,
      ),
    )
    if (!rows) fail(400, 'We could not load the cadence.')
    return c.json(rows[0] ? leadCadence.parse(rows[0]) : null)
  })

  .post('/leads/:id/cadence', edit, async (c) => {
    const parsed = startCadenceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a cadence.')
    const leadId = uuidParam(c)
    const rows = await attempt(c, 'crm.cadence_start', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ next_at: string }[]>`
        select start_lead_cadence(${leadId}, ${parsed.data.cadence_id}) as next_at`),
    )
    if (!rows) fail(400, 'We could not start the cadence.')
    await audit(c, { action: 'lead.cadence_start', entityType: 'crm_lead', entityId: leadId, after: parsed.data })
    return c.json(cadenceStartResponse.parse({ next_at: rows[0]?.next_at ?? null }))
  })

  .delete('/leads/:id/cadence', edit, async (c) => {
    const leadId = uuidParam(c)
    const rows = await attempt(c, 'crm.cadence_stop', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ ok: boolean }[]>`
        select stop_lead_cadence(${leadId}) as ok`),
    )
    if (!rows) fail(400, 'We could not stop the cadence.')
    if (!rows[0]?.ok) fail(404, 'This lead is not on a cadence.')
    await audit(c, { action: 'lead.cadence_stop', entityType: 'crm_lead', entityId: leadId })
    return c.body(null, 204)
  })

  // Lovable parity: Mark-as-Sent — the step went out (by hand or on a call),
  // so log the activity, stamp the contact, move the follow-up and the stage.
  .post('/leads/:id/cadence/sent', edit, async (c) => {
    const parsed = markCadenceSentRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid mark-as-sent.')
    const leadId = uuidParam(c)
    const { next_follow_up_days, next_stage_id, note } = parsed.data
    const followUpAt =
      next_follow_up_days === null || next_follow_up_days === undefined
        ? null
        : new Date(Date.now() + next_follow_up_days * 86_400_000).toISOString()
    const ok = await attempt(c, 'crm.cadence_sent', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [lead] = await sql<{ id: string; name: string | null }[]>`
          select id, name from crm_leads where id = ${leadId}`
        if (!lead) return 'no_lead' as const
        if (next_stage_id) {
          const [stage] = await sql<{ id: string }[]>`
            select id from crm_pipeline_stages where id = ${next_stage_id}`
          if (!stage) return 'no_stage' as const
        }
        await sql`
          update crm_leads
             set last_contacted_at = coalesce(last_contacted_at, now()),
                 contacted_status = 'contacted',
                 follow_up_at = coalesce(${followUpAt}::timestamptz, follow_up_at)
           where id = ${leadId}`
        if (next_stage_id) {
          await sql`select crm_move_stage(${leadId}, ${next_stage_id})`
        }
        await sql`
          insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, started_at)
          values (get_current_company_id(), ${leadId}, 'note', 'out',
                  'Marked as sent', ${note ?? 'Cadence step marked as sent.'}, 'manual', now())`
        await sql`
          insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
          values (get_current_company_id(), ${leadId}, null, null, ${c.get('auth').userId},
                  ${`marked cadence step as sent${note ? `: ${note}` : ''}`})`
        return true
      }),
    )
    if (ok === 'no_lead') fail(404, 'That lead was not found.')
    if (ok === 'no_stage') fail(422, 'That stage was not found.')
    if (!ok) fail(400, 'We could not record that send.')
    await audit(c, { action: 'lead.cadence_sent', entityType: 'crm_lead', entityId: leadId, after: parsed.data })
    return c.body(null, 204)
  })
