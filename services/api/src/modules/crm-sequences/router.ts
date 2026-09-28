import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import { enrollRequest, leadSequence, sequence, sequenceInput, sequencePatch, sequenceSend, type SequenceSend } from '@ipc/contracts'
import { fillSequenceText } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { loadStudioBrand } from '../../lib/studio-brand'

/**
 * Sequences (0202), under /crm: the follow-up plans whose steps write a
 * WhatsApp message or an email, the "Send now" list of messages waiting for
 * a tap, and where one lead is on its sequence. The sweep and the sender are
 * in SQL and lib/sequence-sender.ts; this is what the screens read and write.
 */
const SEES_ALL = new Set(['super_admin', 'admin', 'manager', 'platform_admin'])
const edit = requireAction('crm', 'edit')
const remove = requireAction('crm', 'delete')

interface SendRow {
  id: string
  lead_id: string
  lead_name: string | null
  phone: string | null
  email: string | null
  city: string | null
  event_type: string | null
  event_date: string | null
  sequence_name: string
  step_no: number
  channel: 'whatsapp' | 'email'
  subject: string | null
  body: string
  status: SequenceSend['status']
  delivery: string | null
  error: string | null
  due_at: string
  sent_at: string | null
}

/** Fill each message in for its lead, the way the sender will. */
async function filled(sql: TransactionSql, rows: SendRow[]): Promise<SequenceSend[]> {
  if (!rows.length) return []
  const [me] = await sql<{ company_id: string }[]>`select get_current_company_id() as company_id`
  const brand = await loadStudioBrand(sql, me!.company_id)
  const studio = { name: brand.name, website: brand.website }
  return rows.map((r) => {
    const lead = { name: r.lead_name, city: r.city, event_type: r.event_type, event_date: r.event_date }
    return sequenceSend.parse({
      id: r.id,
      lead_id: r.lead_id,
      lead_name: r.lead_name,
      phone: r.phone,
      email: r.email,
      sequence_name: r.sequence_name,
      step_no: r.step_no,
      channel: r.channel,
      subject: r.subject ? fillSequenceText(r.subject, lead, studio) : null,
      text: fillSequenceText(r.body, lead, studio),
      status: r.status,
      delivery: r.delivery,
      error: r.error,
      due_at: r.due_at,
      sent_at: r.sent_at,
    })
  })
}

const sendColumns = (sql: TransactionSql) => sql`
  s.id, s.lead_id, l.name as lead_name, l.phone, l.email, l.city, l.event_type, l.event_date::text as event_date,
  c.name as sequence_name, s.step_no, s.channel, s.subject, s.body, s.status, s.delivery, s.error, s.due_at, s.sent_at`

async function writeSteps(sql: TransactionSql, id: string, steps: ReturnType<typeof sequenceInput.parse>['steps']) {
  await sql`delete from crm_cadence_steps where cadence_id = ${id}`
  for (const [i, s] of steps.entries()) {
    // Only a WhatsApp step carries a template.
    const wa = s.channel === 'whatsapp' && !!s.wa_template_name
    await sql`
      insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, channel, send_hour, subject, body, note,
                                     wa_template_name, wa_template_lang, wa_params)
      values (${id}, get_current_company_id(), ${i + 1}, ${s.day_offset}, ${s.channel}, ${s.send_hour},
              ${s.channel === 'email' ? (s.subject ?? null) : null}, ${s.channel === 'reminder' ? null : (s.body ?? null)},
              ${s.note ?? null},
              ${wa ? s.wa_template_name! : null}, ${wa ? (s.wa_template_lang ?? 'en') : null},
              ${wa ? sql.json(s.wa_params ?? []) : null})`
  }
  // Leads already past the new last step have nothing left to do.
  await sql`
    update crm_lead_cadences set completed_at = now(), next_at = null
     where cadence_id = ${id} and completed_at is null and stopped_at is null and step_no > ${steps.length}`
}

export const crmSequencesRouter = new Hono<AppEnv>()
  .use('/sequences', requireAuth, requireModule('crm'))
  .use('/sequences/*', requireAuth, requireModule('crm'))
  .use('/leads/:id/sequence', requireAuth, requireModule('crm'))

  .get('/sequences', async (c) => {
    const rows = await attempt(c, 'crm.sequences', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select ca.id, ca.name, ca.description, ca.is_active, ca.auto_start, ca.stage_filter, ca.source_filter,
               ca.stop_on_reply, ca.starter_key,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'step_no', s.step_no, 'day_offset', s.day_offset, 'channel', s.channel, 'send_hour', s.send_hour,
                   'subject', s.subject, 'body', s.body, 'note', s.note, 'template_name', t.name,
                   'wa_template_name', s.wa_template_name, 'wa_template_lang', s.wa_template_lang, 'wa_params', s.wa_params) order by s.step_no)
                   from crm_cadence_steps s left join crm_templates t on t.id = s.template_id
                  where s.cadence_id = ca.id), '[]'::jsonb) as steps,
               (select count(*) from crm_lead_cadences lc
                 where lc.cadence_id = ca.id and lc.completed_at is null and lc.stopped_at is null)::int as active_leads,
               (select count(*) from crm_sequence_sends x where x.cadence_id = ca.id and x.status = 'sent')::int as sent,
               (select count(*) from crm_sequence_sends x where x.cadence_id = ca.id and x.status in ('manual', 'queued'))::int as waiting,
               (select count(*) from crm_lead_cadences lc where lc.cadence_id = ca.id and lc.stopped_reason = 'replied')::int as replied
          from crm_cadences ca
         order by ca.is_active desc, ca.created_at,
                  array_position(array['new_enquiry', 'quotation_sent', 'after_shoot'], ca.starter_key), ca.name`),
    )
    if (!rows) fail(400, 'We could not load your sequences.')
    return c.json(sequence.array().parse(rows))
  })

  .post('/sequences', edit, async (c) => {
    const parsed = sequenceInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the sequence.')
    const v = parsed.data
    const id = await attempt(c, 'crm.sequence_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [row] = await sql<{ id: string }[]>`
          insert into crm_cadences (company_id, name, description, is_active, auto_start, stage_filter, source_filter, stop_on_reply)
          values (get_current_company_id(), ${v.name}, ${v.description ?? null}, ${v.is_active}, ${v.auto_start},
                  ${v.stage_filter || null}, ${v.source_filter || null}, ${v.stop_on_reply})
          returning id`
        await writeSteps(sql, row!.id, v.steps)
        return row!.id
      }),
    )
    if (!id) fail(400, 'We could not save this sequence.')
    await audit(c, { action: 'sequence.create', entityType: 'crm_cadence', entityId: id, after: { name: v.name, steps: v.steps.length, auto_start: v.auto_start } })
    return c.json({ id }, 201)
  })

  .put('/sequences/:id', edit, async (c) => {
    const id = uuidParam(c)
    const parsed = sequenceInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the sequence.')
    const v = parsed.data
    const ok = await attempt(c, 'crm.sequence_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          update crm_cadences
             set name = ${v.name}, description = ${v.description ?? null}, is_active = ${v.is_active},
                 auto_start = ${v.auto_start}, stage_filter = ${v.stage_filter || null},
                 source_filter = ${v.source_filter || null}, stop_on_reply = ${v.stop_on_reply}
           where id = ${id} returning id`
        if (!rows.length) return 'missing' as const
        await writeSteps(sql, id, v.steps)
        return 'ok' as const
      }),
    )
    if (!ok) fail(400, 'We could not save this sequence.')
    if (ok === 'missing') fail(404, 'That sequence was not found.')
    await audit(c, { action: 'sequence.update', entityType: 'crm_cadence', entityId: id, after: { name: v.name, steps: v.steps.length, auto_start: v.auto_start } })
    return c.body(null, 204)
  })

  .patch('/sequences/:id', edit, async (c) => {
    const id = uuidParam(c)
    const parsed = sequencePatch.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success || !Object.keys(parsed.data).length) fail(422, 'Nothing to change.')
    const rows = await attempt(c, 'crm.sequence_patch', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update crm_cadences set ${sql(parsed.data)} where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not change this sequence.')
    if (!rows.length) fail(404, 'That sequence was not found.')
    await audit(c, { action: 'sequence.update', entityType: 'crm_cadence', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/sequences/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.sequence_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`delete from crm_cadences where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this sequence.')
    if (!rows.length) fail(404, 'That sequence was not found.')
    await audit(c, { action: 'sequence.delete', entityType: 'crm_cadence', entityId: id })
    return c.body(null, 204)
  })

  .post('/sequences/starters', edit, async (c) => {
    const rows = await attempt(c, 'crm.sequence_starters', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ n: number }[]>`select crm_add_starter_sequences() as n`),
    )
    if (!rows) fail(400, 'We could not add the starter sequences.')
    return c.json({ added: rows[0]?.n ?? 0 })
  })

  .post('/sequences/:id/enroll', edit, async (c) => {
    const id = uuidParam(c)
    const parsed = enrollRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick the leads to add.')
    const started = await attempt(c, 'crm.sequence_enroll', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const leads = await sql<{ id: string }[]>`
          select id from crm_leads
           where id in ${sql(parsed.data.lead_ids)} and not is_archived and merged_into is null
             and status not in ('converted', 'lost')`
        for (const l of leads) await sql`select start_lead_cadence(${l.id}, ${id})`
        return leads.length
      }),
    )
    if (started === null) fail(400, 'We could not add these leads.')
    await audit(c, { action: 'sequence.enroll', entityType: 'crm_cadence', entityId: id, after: { leads: started } })
    return c.json({ started, skipped: parsed.data.lead_ids.length - started })
  })

  // "Send now": messages written and waiting for a person to send them.
  .get('/sequences/sends', async (c) => {
    const auth = c.get('auth')
    const all = SEES_ALL.has(auth.role)
    const rows = await attempt(c, 'crm.sequence_sends', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const due = await sql<SendRow[]>`
          select ${sendColumns(sql)}
            from crm_sequence_sends s
            join crm_leads l on l.id = s.lead_id
            join crm_cadences c on c.id = s.cadence_id
           where s.status = 'manual'
             and (${all} or l.assigned_to = ${auth.userId} or l.assigned_to is null)
           order by s.due_at
           limit 200`
        return filled(sql, due)
      }),
    )
    if (!rows) fail(400, 'We could not load the messages to send.')
    return c.json({ items: rows })
  })

  .post('/sequences/sends/:id/done', edit, async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const ok = await attempt(c, 'crm.sequence_send_done', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [row] = await sql<SendRow[]>`
          select ${sendColumns(sql)}
            from crm_sequence_sends s join crm_leads l on l.id = s.lead_id join crm_cadences c on c.id = s.cadence_id
           where s.id = ${id} and s.status = 'manual'`
        if (!row) return false
        const [msg] = await filled(sql, [row])
        await sql`update crm_sequence_sends set status = 'sent', sent_at = now(), done_by = ${auth.userId} where id = ${id}`
        await sql`
          insert into crm_activities (company_id, lead_id, type, direction, subject, body, started_at)
          values (get_current_company_id(), ${row.lead_id}, ${row.channel}, 'out', ${msg!.subject ?? row.sequence_name}, ${msg!.text}, now())`
        return true
      }),
    )
    if (ok === null) fail(400, 'We could not mark it sent.')
    if (!ok) fail(404, 'That message is not waiting to be sent.')
    return c.body(null, 204)
  })

  .post('/sequences/sends/:id/skip', edit, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.sequence_send_skip', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update crm_sequence_sends set status = 'skipped', error = 'Skipped', done_by = ${c.get('auth').userId}
         where id = ${id} and status in ('manual', 'queued') returning id`),
    )
    if (!rows) fail(400, 'We could not skip it.')
    if (!rows.length) fail(404, 'That message is not waiting to be sent.')
    return c.body(null, 204)
  })

  // Where one lead is: its sequence and every message written for it.
  .get('/leads/:id/sequence', async (c) => {
    const leadId = uuidParam(c)
    const out = await attempt(c, 'crm.lead_sequence', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [current] = await sql`
          select lc.cadence_id, ca.name, lc.step_no,
                 (select count(*) from crm_cadence_steps s where s.cadence_id = lc.cadence_id)::int as total_steps,
                 lc.next_at,
                 (select s.channel from crm_cadence_steps s where s.cadence_id = lc.cadence_id and s.step_no = lc.step_no) as next_channel,
                 lc.started_at, lc.completed_at, lc.stopped_at, lc.stopped_reason
            from crm_lead_cadences lc join crm_cadences ca on ca.id = lc.cadence_id
           where lc.lead_id = ${leadId}`
        const sends = await sql<SendRow[]>`
          select ${sendColumns(sql)}
            from crm_sequence_sends s join crm_leads l on l.id = s.lead_id join crm_cadences c on c.id = s.cadence_id
           where s.lead_id = ${leadId}
           order by s.created_at desc
           limit 50`
        return { current: current ?? null, sends: await filled(sql, sends) }
      }),
    )
    if (!out) fail(400, 'We could not load this lead’s sequence.')
    return c.json(leadSequence.parse(out))
  })
