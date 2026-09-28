import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  activitiesQuery,
  createActivityRequest,
  crmActivity,
  crmIntegration,
  emailSyncRequest,
  emailSyncResponse,
  integrationProvider,
  placeCallRequest,
  placeCallResponse,
  scheduleMeetingRequest,
  scheduleMeetingResponse,
  timelineQuery,
  timelineResponse,
  updateActivityRequest,
  updateIntegrationRequest,
} from '@ipc/contracts'
import { buildIcs } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { e164, placeCall, twilioConfigured } from '../../lib/twilio'
import { emailProvider, emailSyncConfigured, fetchRecentMessages } from '../../lib/email-sync'
import { log } from '../../lib/log'

/**
 * Activities: what a person did about a deal. Calls, emails, meetings, notes,
 * tasks and messages, logged by hand or by an integration, merged with the
 * stage trail into one timeline. Mounted under /crm with the leads router's
 * auth and module guard.
 */
const edit = requireAction('crm', 'edit')
const remove = requireAction('crm', 'delete')

const selectActivity = (sql: TransactionSql) => sql`
  select a.id, a.lead_id, l.name as lead_name, a.contact_id, ct.name as contact_name, a.type, a.direction, a.subject, a.body, a.outcome,
         a.started_at, a.ended_at, a.duration_s, a.due_at, a.done_at, a.assigned_to, au.name as assignee_name,
         a.actor_id, ac.name as actor_name, a.provider, a.external_id, a.meta ->> 'location' as location, a.priority, a.meta, a.created_at
  from crm_activities a
  left join crm_leads l on l.id = a.lead_id
  left join users au on au.user_id = a.assigned_to
  left join users ac on ac.user_id = a.actor_id
  left join crm_contacts ct on ct.id = a.contact_id`

export const crmActivitiesRouter = new Hono<AppEnv>()
  // ── Feed and CRUD ───────────────────────────────────────────
  .get('/activities', async (c) => {
    const q = activitiesQuery.safeParse({
      lead_id: c.req.query('lead_id'),
      contact_id: c.req.query('contact_id'),
      type: c.req.query('type'),
      assigned_to: c.req.query('assigned_to'),
      open_tasks: c.req.query('open_tasks'),
      mine: c.req.query('mine'),
      due_before: c.req.query('due_before'),
      limit: c.req.query('limit'),
    })
    if (!q.success) fail(422, 'Invalid query.')
    const { lead_id, contact_id, type, assigned_to, open_tasks, mine, due_before, limit } = q.data
    const me = c.get('auth').userId
    const rows = await attempt(c, 'crm.activities', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          ${selectActivity(sql)}
          where ${lead_id ? sql`a.lead_id = ${lead_id}` : sql`true`}
            and ${contact_id ? sql`a.contact_id = ${contact_id}` : sql`true`}
            and ${type ? sql`a.type = ${type}` : sql`true`}
            and ${assigned_to ? sql`a.assigned_to = ${assigned_to}` : sql`true`}
            and ${open_tasks ? sql`a.type = 'task' and a.done_at is null` : sql`true`}
            and ${mine ? sql`coalesce(a.assigned_to, l.assigned_to) = ${me}` : sql`true`}
            and ${due_before ? sql`a.due_at < ${due_before}` : sql`true`}
          order by ${open_tasks ? sql`a.due_at asc nulls last, a.created_at desc` : sql`a.created_at desc`}
          limit ${limit}`,
      ),
    )
    if (!rows) fail(400, 'We could not load activities.')
    return c.json(crmActivity.array().parse(rows))
  })

  .post('/activities', edit, async (c) => {
    const parsed = createActivityRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the activity.')
    const v = parsed.data
    const row = await attempt(c, 'crm.activity_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ id: string }[]>`
          insert into crm_activities (company_id, lead_id, contact_id, type, direction, subject, body, outcome,
                                      started_at, ended_at, duration_s, due_at, assigned_to, priority)
          values (get_current_company_id(), ${v.lead_id ?? null}, ${v.contact_id ?? null}, ${v.type}, ${v.direction},
                  ${v.subject ?? null}, ${v.body ?? null}, ${v.outcome ?? null}, ${v.started_at ?? null}, ${v.ended_at ?? null},
                  ${v.duration_s ?? null}, ${v.due_at ?? null}, ${v.assigned_to ?? null}, ${v.priority || null})
          returning id`
        if (!r) return null
        const [full] = await sql`${selectActivity(sql)} where a.id = ${r.id}`
        return full ?? null
      }),
    )
    if (!row) fail(400, 'We could not log this activity.')
    const created = crmActivity.parse(row)
    await audit(c, { action: 'activity.create', entityType: 'crm_activity', entityId: created.id, after: { type: v.type, lead_id: v.lead_id ?? null } })
    return c.json(created, 201)
  })

  .patch('/activities/:id', edit, async (c) => {
    const parsed = updateActivityRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const { done, location, ...rest } = parsed.data
    const patch: Record<string, unknown> = { ...rest }
    if (done !== undefined) patch.done_at = done ? new Date().toISOString() : null
    const rows = await attempt(c, 'crm.activity_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        if (location !== undefined) {
          await sql`
            update crm_activities
               set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{location}', ${sql.json(location)})
             where id = ${id}`
        }
        if (Object.keys(patch).length === 0) {
          return sql<{ id: string }[]>`select id from crm_activities where id = ${id}`
        }
        return sql<{ id: string }[]>`update crm_activities set ${sql(patch)} where id = ${id} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update this activity.')
    if (!rows.length) fail(404, 'That activity was not found.')
    await audit(c, { action: 'activity.update', entityType: 'crm_activity', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/activities/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.activity_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`delete from crm_activities where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this activity.')
    if (!rows.length) fail(404, 'That activity was not found.')
    await audit(c, { action: 'activity.delete', entityType: 'crm_activity', entityId: id })
    return c.body(null, 204)
  })

  // ── Timeline: the stage trail and the activities, merged ────
  .get('/leads/:id/timeline', async (c) => {
    const leadId = uuidParam(c)
    const q = timelineQuery.safeParse({ before: c.req.query('before'), limit: c.req.query('limit') })
    if (!q.success) fail(422, 'Invalid query.')
    const { before, limit } = q.data
    const rows = await attempt(c, 'crm.timeline', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const events = await sql`
          select e.id, e.lead_id, e.from_status, e.to_status, e.actor_id, u.name as actor_name, e.note, e.created_at
          from crm_lead_events e
          left join users u on u.user_id = e.actor_id
          where e.lead_id = ${leadId} and ${before ? sql`e.created_at < ${before}` : sql`true`}
          order by e.created_at desc
          limit ${limit}`
        const activities = await sql`
          ${selectActivity(sql)}
          where a.lead_id = ${leadId} and ${before ? sql`a.created_at < ${before}` : sql`true`}
          order by a.created_at desc
          limit ${limit}`
        return { events, activities }
      }),
    )
    if (!rows) fail(400, 'We could not load the timeline.')
    const merged = [
      ...rows.events.map((e) => ({ kind: 'event' as const, at: String(e.created_at), event: e })),
      ...rows.activities.map((a) => ({ kind: 'activity' as const, at: String(a.created_at), activity: a })),
    ].sort((a, b) => b.at.localeCompare(a.at) || (a.kind === 'event' ? -1 : 1))

    // The cursor is a timestamp and the next page asks for strictly older
    // rows, so a page must not end in the middle of a group that shares one
    // instant — whatever was left behind would never be asked for again.
    // Carry the whole group instead; a page may run slightly long.
    let end = Math.min(limit, merged.length)
    while (end > 0 && end < merged.length && merged[end]!.at === merged[end - 1]!.at) end += 1
    const items = merged.slice(0, end)
    const more = merged.length > items.length || rows.events.length === limit || rows.activities.length === limit
    return c.json(timelineResponse.parse({ items, next_cursor: more && items.length ? items[items.length - 1]!.at : null }))
  })

  // ── Click-to-call ───────────────────────────────────────────
  // Twilio rings the agent, then the lead. Without Twilio the call is logged
  // as a manual one and the client gets a tel: link to dial.
  .post('/activities/call', edit, async (c) => {
    const parsed = placeCallRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick the deal to call.')
    const v = parsed.data
    const auth = c.get('auth')
    const lead = await attempt(c, 'crm.call_lookup', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [l] = await sql<{ phone_norm: string | null; phone: string | null }[]>`select phone_norm, phone from crm_leads where id = ${v.lead_id}`
        if (!l) return 'missing' as const
        const [me] = await sql<{ phone: string | null }[]>`select phone from users where user_id = ${auth.userId}`
        return { ...l, agent: v.agent_phone ?? me?.phone ?? null }
      }),
    )
    if (lead === 'missing') fail(404, 'That deal was not found.')
    if (!lead) fail(400, 'We could not look up the deal.')
    if (!lead.phone_norm) fail(422, 'This deal has no phone number to call.')

    let placed = false
    let sid: string | null = null
    if (twilioConfigured(c.env)) {
      if (!lead.agent) fail(422, 'Add your phone number to your profile so we can ring you first.')
      const agentNorm = lead.agent.replace(/\D/g, '')
      const call = await attempt(c, 'crm.call_place', () => placeCall(c.env, agentNorm, lead.phone_norm!))
      if (!call) fail(400, 'The call could not be placed. Please try again.')
      placed = true
      sid = call.sid
    }
    const row = await attempt(c, 'crm.call_log', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [r] = await sql<{ id: string }[]>`
          insert into crm_activities (company_id, lead_id, type, direction, subject, provider, external_id, started_at, meta)
          values (get_current_company_id(), ${v.lead_id}, 'call', 'out', ${placed ? 'Call via Twilio' : 'Call'},
                  ${placed ? 'twilio' : 'manual'}, ${sid}, now(), ${sql.json({ placed })})
          returning id`
        if (!r) return null
        const [full] = await sql`${selectActivity(sql)} where a.id = ${r.id}`
        return full ?? null
      }),
    )
    if (!row) fail(400, 'We could not log the call.')
    const activity = crmActivity.parse(row)
    await audit(c, { action: 'activity.call', entityType: 'crm_activity', entityId: activity.id, after: { lead_id: v.lead_id, placed } })
    return c.json(
      placeCallResponse.parse({
        activity,
        placed,
        provider: placed ? 'twilio' : 'manual',
        call_sid: sid,
        dial_url: placed ? null : `tel:${e164(lead.phone_norm)}`,
      }),
      201,
    )
  })

  // ── Meetings ────────────────────────────────────────────────
  .post('/activities/meeting', edit, async (c) => {
    const parsed = scheduleMeetingRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the meeting.')
    const v = parsed.data
    const auth = c.get('auth')
    const row = await attempt(c, 'crm.meeting_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [l] = await sql<{ id: string; email: string | null; assigned_to: string | null; name: string | null }[]>`
          select id, email, assigned_to, name from crm_leads where id = ${v.lead_id}`
        if (!l) return 'missing' as const
        const [r] = await sql<{ id: string }[]>`
          insert into crm_activities (company_id, lead_id, type, direction, subject, body, started_at, ended_at, assigned_to, meta)
          values (get_current_company_id(), ${v.lead_id}, 'meeting', 'out', ${v.subject}, ${v.notes ?? null}, ${v.starts_at}, ${v.ends_at},
                  ${l.assigned_to ?? auth.userId}, ${sql.json({ location: v.location ?? null, invite_lead: v.invite_lead && !!l.email })})
          returning id`
        if (!r) return null
        if (l.assigned_to && l.assigned_to !== auth.userId) {
          // Every generator in 0125 passes a severity and a deep link; this
          // was the one call site that stopped at the entity, so the only
          // notification the API itself writes was the only one you could not
          // click through. `?lead=` opens the deal's drawer, archived or not.
          await sql`
            select create_notification(get_current_company_id(), ${l.assigned_to}, 'crm_meeting',
              ${`Meeting: ${v.subject}`}, ${`With ${l.name ?? 'a lead'} on ${new Date(v.starts_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`},
              ${`crm_meeting:${r.id}`}, 'crm_lead', ${v.lead_id},
              'info', ${`/follow-ups?lead=${v.lead_id}`})`
        }
        const [full] = await sql`${selectActivity(sql)} where a.id = ${r.id}`
        return full ?? null
      }),
    )
    if (row === 'missing') fail(404, 'That deal was not found.')
    if (!row) fail(400, 'We could not schedule the meeting.')
    const activity = crmActivity.parse(row)
    await audit(c, { action: 'activity.meeting', entityType: 'crm_activity', entityId: activity.id, after: { lead_id: v.lead_id, starts_at: v.starts_at } })
    return c.json(scheduleMeetingResponse.parse({ activity, ics_url: `/crm/activities/${activity.id}/ics` }), 201)
  })

  .get('/activities/:id/ics', async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'crm.meeting_ics', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [a] = await sql<{
          id: string
          subject: string | null
          body: string | null
          started_at: string | null
          ended_at: string | null
          meta: { location?: string | null; invite_lead?: boolean }
          lead_name: string | null
          lead_email: string | null
          studio: string
          studio_email: string | null
        }[]>`
          select a.id, a.subject, a.body, a.started_at, a.ended_at, a.meta, l.name as lead_name, l.email as lead_email,
                 co.name as studio, ou.email as studio_email
          from crm_activities a
          left join crm_leads l on l.id = a.lead_id
          join companies co on co.id = a.company_id
          left join users ou on ou.user_id = co.owner_user_id
          where a.id = ${id} and a.type = 'meeting'`
        return a ?? null
      }),
    )
    if (!row) fail(404, 'That meeting was not found.')
    if (!row.started_at || !row.ended_at) fail(422, 'This meeting has no time set.')
    const ics = buildIcs({
      uid: `${row.id}@ipc-crm`,
      title: row.subject ?? 'Meeting',
      start: new Date(row.started_at),
      end: new Date(row.ended_at),
      description: row.body ?? undefined,
      location: row.meta?.location ?? undefined,
      organizer: row.studio_email ? { name: row.studio, email: row.studio_email } : undefined,
      attendees: row.meta?.invite_lead && row.lead_email ? [{ name: row.lead_name ?? undefined, email: row.lead_email }] : [],
    })
    c.header('Content-Type', 'text/calendar; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="meeting-${row.id.slice(0, 8)}.ics"`)
    return c.body(ics)
  })

  // ── Mailbox sync ────────────────────────────────────────────
  // Pulls recent messages from the configured mailbox and files each one
  // under the deal (or contact) whose email it matches. Idempotent on the
  // provider's message id; unconfigured = nothing happens, said plainly.
  .post('/activities/email/sync', edit, async (c) => {
    const parsed = emailSyncRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid request.')
    const auth = c.get('auth')
    const provider = emailProvider(c.env)
    if (!provider || !emailSyncConfigured(c.env)) {
      return c.json(emailSyncResponse.parse({ status: 'not_configured', provider, fetched: 0, imported: 0, unmatched: 0, message: 'Set EMAIL_SYNC_PROVIDER, EMAIL_SYNC_TOKEN and EMAIL_SYNC_MAILBOX on the API to sync a mailbox.' }))
    }
    let messages
    try {
      messages = await fetchRecentMessages(c.env, { sinceDays: parsed.data.since_days })
    } catch (err) {
      log.error({ err: String(err), provider }, 'email sync failed')
      await attempt(c, 'crm.email_sync_error', () =>
        withUser(c.env, auth.userId, (sql) => sql`
          insert into crm_integrations (company_id, provider, status, last_error)
          values (get_current_company_id(), ${provider}, 'error', ${String(err).slice(0, 300)})
          on conflict (company_id, provider) do update set status = 'error', last_error = excluded.last_error`),
      )
      return c.json(emailSyncResponse.parse({ status: 'error', provider, fetched: 0, imported: 0, unmatched: 0, message: 'The mailbox refused the request. Check the token.' }))
    }
    const result = await attempt(c, 'crm.email_sync', () =>
      withUser(c.env, auth.userId, async (sql) => {
        let imported = 0
        let unmatched = 0
        for (const m of messages) {
          const [target] = await sql<{ lead_id: string | null; contact_id: string | null }[]>`
            select l.id as lead_id, l.contact_id
            from crm_leads l
            where lower(l.email) = ${m.counterpart} and l.is_archived = false
            order by (l.status not in ('converted', 'lost')) desc, l.created_at desc
            limit 1`
          const contact = target
            ? null
            : (await sql<{ id: string }[]>`select id from crm_contacts where lower(email) = ${m.counterpart} limit 1`)[0]
          if (!target && !contact) {
            unmatched += 1
            continue
          }
          const rows = await sql<{ id: string }[]>`
            insert into crm_activities (company_id, lead_id, contact_id, type, direction, subject, body, provider, external_id, started_at, created_at)
            values (get_current_company_id(), ${target?.lead_id ?? null}, ${target?.contact_id ?? contact?.id ?? null}, 'email', ${m.direction},
                    ${m.subject.slice(0, 200)}, ${m.snippet.slice(0, 8000)}, ${provider}, ${m.external_id}, ${m.at}, ${m.at})
            on conflict (company_id, provider, external_id) where external_id is not null do nothing
            returning id`
          if (rows.length) imported += 1
        }
        await sql`
          insert into crm_integrations (company_id, provider, status, last_sync_at, last_error, connected_by)
          values (get_current_company_id(), ${provider}, 'connected', now(), null, ${auth.userId})
          on conflict (company_id, provider) do update set status = 'connected', last_sync_at = now(), last_error = null`
        return { imported, unmatched }
      }),
    )
    if (!result) fail(400, 'The sync could not be saved.')
    await audit(c, { action: 'activity.email_sync', entityType: 'crm_integration', entityId: provider, after: { fetched: messages.length, ...result } })
    return c.json(emailSyncResponse.parse({ status: 'ok', provider, fetched: messages.length, ...result, message: null }))
  })

  // ── Integrations ────────────────────────────────────────────
  .get('/integrations', async (c) => {
    const rows = await attempt(c, 'crm.integrations', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<
        { provider: string; status: string; config: unknown; last_error: string | null; last_sync_at: string | null; connected_by: string | null; updated_at: string | null }[]
      >`select provider, status, config, last_error, last_sync_at, connected_by, updated_at from crm_integrations`),
    )
    if (!rows) fail(400, 'We could not load integrations.')
    const present: Record<string, boolean> = {
      gmail: emailProvider(c.env) === 'gmail' && emailSyncConfigured(c.env),
      o365: emailProvider(c.env) === 'o365' && emailSyncConfigured(c.env),
      twilio: twilioConfigured(c.env),
    }
    const out = integrationProvider.options.map((p) => {
      const row = rows.find((r) => r.provider === p)
      return {
        provider: p,
        status: row?.status ?? 'not_configured',
        credentials_present: present[p] ?? false,
        config: row?.config ?? {},
        last_error: row?.last_error ?? null,
        last_sync_at: row?.last_sync_at ?? null,
        connected_by: row?.connected_by ?? null,
        updated_at: row?.updated_at ?? null,
      }
    })
    return c.json(crmIntegration.array().parse(out))
  })

  .put('/integrations/:provider', edit, async (c) => {
    const provider = integrationProvider.safeParse(c.req.param('provider'))
    if (!provider.success) fail(404, 'Unknown integration.')
    const parsed = updateIntegrationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    const auth = c.get('auth')
    if (!auth.isOwner) fail(403, 'Only the studio owner can change integrations.')
    const v = parsed.data
    const row = await attempt(c, 'crm.integration_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [r] = await sql<{ provider: string }[]>`
          insert into crm_integrations (company_id, provider, status, config, connected_by)
          values (get_current_company_id(), ${provider.data}, ${v.status ?? 'not_configured'}, ${sql.json(v.config ?? {})}, ${auth.userId})
          on conflict (company_id, provider) do update
            set status = coalesce(${v.status ?? null}, crm_integrations.status),
                config = case when ${v.config !== undefined} then ${sql.json(v.config ?? {})} else crm_integrations.config end,
                connected_by = ${auth.userId}, last_error = null
          returning provider`
        return r ?? null
      }),
    )
    if (!row) fail(400, 'We could not save the integration.')
    await audit(c, { action: 'integration.update', entityType: 'crm_integration', entityId: provider.data, after: v })
    return c.body(null, 204)
  })
