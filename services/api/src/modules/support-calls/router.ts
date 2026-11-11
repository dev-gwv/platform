import { Hono } from 'hono'
import {
  saveSupportCalendarRequest,
  supportTicketFollowupRequest,
  supportTicketNoteRequest,
  supportWhatsappOverview,
  supportWhatsappSettings,
  updateSupportTicketRequest,
} from '@ipc/contracts'
import { z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { describeError, log } from '../../lib/log'
import { whatsappConfigured } from '../../lib/whatsapp'
import { maskNumber, sampleNotice } from '../../lib/support-calls'
import { looksLikeIcal, maskIcal, refPrefix } from '../../lib/support-calendar'
import { syncSupportCalendar } from '../../lib/support-calendar-sync'
import { botGroups, botLogout, botStatus, drainSupportCalls, queueTest, readSupportSettings, saveSupportCallNotice } from '../../lib/support-call-store'
import { uuidParam } from '../../lib/params'
import { applyNote, briefTicket, getTicket, listTickets, transcribe, updateTicket } from '../../lib/support-ticket-store'
import { draftFollowup, markIssueOpened, sendFollowup } from '../../lib/support-ticket-followups'

/** A voice note this long is plenty; Whisper takes 25 MB, most phones send under 2. */
const MAX_VOICE_BYTES = 20 * 1024 * 1024

/** Send what is due now, without holding up the answer to whoever asked. */
function drainSoon(env: AppEnv['Bindings']) {
  void drainSupportCalls(env).catch((err: unknown) => log.error({ err: describeError(err) }, 'support call drain failed'))
}

const saveRequest = supportWhatsappSettings

/**
 * Platform -> Support calls: platform admins only (requirePlatformAdmin) --
 * studios and their teams never see these switches, numbers or messages.
 */
export const platformSupportCallsRouter = new Hono<AppEnv>()
  .use('/support-calls', requireAuth, requirePlatformAdmin())
  .use('/support-calls/*', requireAuth, requirePlatformAdmin())

  .get('/support-calls', async (c) => {
    const [bot, data] = await Promise.all([
      botStatus(c.env),
      attempt(c, 'platform.support_calls', () =>
        withService(c.env, async (sql) => {
          const settings = await readSupportSettings(sql)
          const bookings = await sql<Record<string, unknown>[]>`
            select id, status, starts_at::text as starts_at, name, studio_name, whatsapp_ok, phone is not null as has_phone
              from support_call_bookings order by starts_at desc limit 20`
          const messages = await sql<Record<string, unknown>[]>`
            select o.id, o.channel, o.audience, o.to_number, o.status, o.last_error, o.send_after::text as send_after,
                   o.sent_at::text as sent_at, o.template, o.dedupe_key, b.name as booking_name
              from support_call_outbox o left join support_call_bookings b on b.id = o.booking_id
             order by o.created_at desc limit 50`
          const sent = await sql<{ hour: number; day: number }[]>`
            select count(*) filter (where sent_at > now() - interval '1 hour')::int as hour,
                   count(*) filter (where sent_at > now() - interval '24 hours')::int as day
              from support_call_outbox where channel = 'group' and status = 'sent'`
          const cals = await sql<{ slot: number; name: string | null; booking_url: string | null; url: string | null; checked_at: string | null; error: string | null }[]>`
            select slot, name, booking_url, ical_url as url, checked_at::text as checked_at, error from support_calendars order by slot`
          const ahead = await sql<{ ref: string }[]>`
            select booking_ref as ref from support_call_bookings
             where booking_ref like 'gcal%' and status <> 'cancelled' and starts_at > now()`
          return { settings, bookings, messages, sent: sent[0] ?? { hour: 0, day: 0 }, cals, ahead: ahead.map((a) => a.ref) }
        }),
      ),
    ])
    if (!data) fail(400, 'We could not load the support calls.')
    const what = (m: Record<string, unknown>) => {
      const key = String(m.dedupe_key ?? '')
      const who = m.booking_name ? ` · ${String(m.booking_name)}` : ''
      if (key.startsWith('summary:')) return "Today's calls"
      if (key.startsWith('test:')) return 'Test'
      if (m.channel === 'group') return `Group post${who}`
      return `${String(m.template ?? 'Template')}${who}`
    }
    return c.json(
      supportWhatsappOverview.parse({
        settings: data.settings,
        ready: { official_api: whatsappConfigured(c.env), bot_secret: !!c.env.WA_BOT_SECRET },
        calendars: data.cals.map((cal) => ({
          slot: cal.slot,
          name: cal.name,
          booking_url: cal.booking_url,
          address: maskIcal(cal.url),
          checked_at: cal.checked_at,
          error: cal.error,
          upcoming: data.ahead.filter((ref) => ref.startsWith(refPrefix(cal.slot))).length,
        })),
        bot: { ...bot, sent_last_hour: data.sent.hour, sent_today: data.sent.day },
        bookings: data.bookings,
        messages: data.messages.map((m) => ({
          id: m.id,
          channel: m.channel,
          audience: m.audience,
          to: m.channel === 'group' ? null : maskNumber((m.to_number as string | null) ?? null),
          what: what(m),
          status: m.status,
          last_error: m.last_error ?? null,
          send_after: m.send_after,
          sent_at: m.sent_at ?? null,
        })),
      }),
    )
  })

  .put('/support-calls/settings', async (c) => {
    const parsed = saveRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the details.')
    const d = parsed.data
    const numbers = [...new Set(d.team_numbers)]
    const ok = await attempt(c, 'platform.support_calls_save', () =>
      withService(c.env, (sql) => sql`
        update platform_settings set
          support_wa_official_on = ${d.official_on}, support_wa_bot_on = ${d.bot_on},
          support_wa_team_numbers = ${numbers}, support_wa_group_jid = ${d.group_jid}, support_wa_group_name = ${d.group_name},
          support_wa_hourly_cap = ${d.hourly_cap}, support_wa_daily_cap = ${d.daily_cap}, support_wa_daily_summary = ${d.daily_summary},
          support_wa_tpl_booked = ${d.tpl_booked}, support_wa_tpl_reminder = ${d.tpl_reminder},
          support_wa_tpl_cancelled = ${d.tpl_cancelled}, support_wa_tpl_team = ${d.tpl_team},
          support_wa_tpl_followup = ${d.tpl_followup}, updated_at = now()`),
    )
    if (!ok) fail(400, 'We could not save the settings.')
    // Numbers are said by count, never written into the audit trail.
    await audit(c, {
      action: 'platform.support_calls_settings',
      entityType: 'platform_settings',
      entityId: null,
      after: { official_on: d.official_on, bot_on: d.bot_on, team_numbers: numbers.length, group: d.group_name, hourly_cap: d.hourly_cap, daily_cap: d.daily_cap, daily_summary: d.daily_summary },
    })
    return c.json({ ok: true })
  })

  .get('/support-calls/groups', async (c) => {
    const groups = await attempt(c, 'platform.support_calls_groups', () => botGroups(c.env))
    if (!groups) fail(400, 'The bot could not list its groups. Is it linked?')
    return c.json(groups)
  })

  .post('/support-calls/bot/logout', async (c) => {
    const ok = await attempt(c, 'platform.support_calls_logout', () => botLogout(c.env).then(() => true))
    if (!ok) fail(400, 'The bot could not be unlinked.')
    await audit(c, { action: 'platform.support_calls_bot_logout', entityType: 'platform_settings', entityId: null })
    return c.json({ ok: true })
  })

  // One person's Google Calendar (0290): the name on the chooser, the booking
  // page studios open, and the calendar's private address. A new address
  // starts quiet: its first read only learns what is already there (0283).
  .put('/support-calls/calendars/:slot', async (c) => {
    const slot = Number(c.req.param('slot'))
    if (slot !== 1 && slot !== 2) fail(404, 'There are two calendars: 1 and 2.')
    const parsed = saveSupportCalendarRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the details.')
    const d = parsed.data
    const icalChanged = d.ical_url !== undefined
    const url = d.ical_url || null
    if (url && !looksLikeIcal(url)) fail(422, 'Use the calendar’s "Secret address in iCal format" (it ends in .ics).')
    const ok = await attempt(c, 'platform.support_calls_calendar', () =>
      withService(c.env, async (sql) => {
        await sql`insert into support_calendars (slot) values (${slot}) on conflict (slot) do nothing`
        await sql`
        update support_calendars
           set name = ${d.name}, booking_url = ${d.booking_url},
               ical_url = case when ${icalChanged} then ${url} else ical_url end,
               primed = case when ${icalChanged} then false else primed end,
               checked_at = case when ${icalChanged} then null else checked_at end,
               error = case when ${icalChanged} then null else error end,
               updated_at = now()
         where slot = ${slot}`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not save the calendar.')
    // Never the address itself in the audit trail: anyone holding it reads the calendar.
    await audit(c, {
      action: 'platform.support_calls_calendar',
      entityType: 'platform_settings',
      entityId: null,
      after: { slot, name: d.name, booking_url: d.booking_url, ...(icalChanged ? { connected: !!url } : {}) },
    })
    const first = url ? await attempt(c, 'platform.support_calls_calendar_first', () => syncSupportCalendar(c.env)) : null
    return c.json({ ok: true, error: first?.error ?? null })
  })

  .post('/support-calls/calendar/check', async (c) => {
    const r = await attempt(c, 'platform.support_calls_calendar_check', () => syncSupportCalendar(c.env))
    if (!r) fail(400, 'We could not read the calendar.')
    if (r.booked + r.moved + r.cancelled > 0) drainSoon(c.env)
    return c.json({ ok: !r.error, error: r.error, booked: r.booked, moved: r.moved, cancelled: r.cancelled })
  })

  // A made-up booking through the whole path, for trying it before the booking
  // app sends real ones. It never messages anyone personally (sampleNotice).
  .post('/support-calls/sample', async (c) => {
    const result = await attempt(c, 'platform.support_calls_sample', () => saveSupportCallNotice(c.env, sampleNotice()))
    if (!result) fail(400, 'We could not make the sample booking.')
    await audit(c, { action: 'platform.support_calls_sample', entityType: 'platform_settings', entityId: null })
    drainSoon(c.env)
    return c.json({ ok: true })
  })

  // ── tickets (0300): one per booked call, kept by the assistant ───────────

  .get('/support-calls/tickets', async (c) => {
    const rows = await attempt(c, 'platform.support_tickets', () => listTickets(c.env))
    if (!rows) fail(400, 'We could not load the tickets.')
    return c.json(rows)
  })

  .get('/support-calls/tickets/:id', async (c) => {
    const id = uuidParam(c)
    const t = await attempt(c, 'platform.support_ticket', () => getTicket(c.env, id))
    if (!t) fail(404, 'That ticket was not found.')
    return c.json(t)
  })

  .patch('/support-calls/tickets/:id', async (c) => {
    const id = uuidParam(c)
    const parsed = updateSupportTicketRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the ticket.')
    const t = await attempt(c, 'platform.support_ticket_update', () => updateTicket(c.env, id, parsed.data))
    if (!t) fail(404, 'That ticket was not found.')
    return c.json(t)
  })

  // The owner's words after the call, typed.
  .post('/support-calls/tickets/:id/note', async (c) => {
    const id = uuidParam(c)
    const parsed = supportTicketNoteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Say a few words about the call.')
    const t = await attempt(c, 'platform.support_ticket_note', () => applyNote(c.env, id, parsed.data.text))
    if (!t) fail(404, 'That ticket was not found.')
    return c.json(t)
  })

  // The owner's words after the call, spoken: heard by Whisper, then read like a typed note.
  .post('/support-calls/tickets/:id/voice', async (c) => {
    const id = uuidParam(c)
    const body = await c.req.parseBody().catch(() => null)
    const file = body?.['audio']
    if (!(file instanceof File) || file.size === 0) fail(422, 'The voice note did not arrive. Record it again.')
    if (file.size > MAX_VOICE_BYTES) fail(422, 'That voice note is too long. Keep it under ten minutes.')
    const heard = await transcribe(c.env, file, file.name || 'note.webm')
    if (!heard.ok) fail(422, heard.error)
    const t = await attempt(c, 'platform.support_ticket_voice', () => applyNote(c.env, id, heard.text))
    if (!t) fail(404, 'That ticket was not found.')
    return c.json(t)
  })

  // 0301: the assistant drafts the follow-up to the studio (kept until sent).
  .post('/support-calls/tickets/:id/followup/draft', async (c) => {
    const id = uuidParam(c)
    const t = await attempt(c, 'platform.support_ticket_followup_draft', () => draftFollowup(c.env, id))
    if (!t) fail(404, 'That ticket was not found.')
    return c.json(t)
  })

  // 0301: the follow-up went -- from the owner's WhatsApp, copied, or from our official number.
  .post('/support-calls/tickets/:id/followup/send', async (c) => {
    const id = uuidParam(c)
    const parsed = supportTicketFollowupRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Write the message first.')
    const r = await attempt(c, 'platform.support_ticket_followup_send', () => sendFollowup(c.env, id, parsed.data.text, parsed.data.via))
    if (!r?.ticket) fail(404, 'That ticket was not found.')
    if (r.error) fail(422, r.error)
    if (parsed.data.via === 'official') drainSoon(c.env)
    return c.json(r.ticket)
  })

  // 0301: a bug's GitHub issue was opened from the ticket.
  .post('/support-calls/tickets/:id/issue', async (c) => {
    const id = uuidParam(c)
    const t = await attempt(c, 'platform.support_ticket_issue', () => markIssueOpened(c.env, id))
    if (!t) fail(404, 'That ticket was not found.')
    return c.json(t)
  })

  // Write the brief again now (it is written by itself an hour before the call).
  .post('/support-calls/tickets/:id/brief', async (c) => {
    const id = uuidParam(c)
    const t = await attempt(c, 'platform.support_ticket_brief', () => getTicket(c.env, id))
    if (!t) fail(404, 'That ticket was not found.')
    const brief = await attempt(c, 'platform.support_ticket_brief_write', async () => {
      const [b] = await withService(c.env, (sql) => sql<{ booking_id: string; page: string | null }[]>`
        select t.booking_id, b.page from support_tickets t join support_call_bookings b on b.id = t.booking_id where t.id = ${id}`)
      return briefTicket(c.env, {
        ticket_id: id,
        booking_id: b!.booking_id,
        company_id: t.company_id,
        starts_at: new Date(t.starts_at),
        ends_at: t.ends_at ? new Date(t.ends_at) : null,
        name: t.name,
        email: t.email,
        notes: t.booking_notes,
        page: b!.page,
        studio_name: t.studio_name,
      })
    })
    if (brief === null) fail(400, 'We could not write the brief.')
    drainSoon(c.env)
    return c.json(await getTicket(c.env, id))
  })

  .post('/support-calls/test', async (c) => {
    const parsed = z.object({ target: z.enum(['group', 'team']) }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Say which test.')
    let refused: string | null = null
    const key = await attempt(c, 'platform.support_calls_test', () =>
      queueTest(c.env, parsed.data.target).catch((err: unknown) => {
        refused = describeError(err).message
        return null
      }),
    )
    if (refused) fail(422, refused)
    if (!key) fail(400, 'We could not queue the test.')
    drainSoon(c.env)
    return c.json({ ok: true })
  })
