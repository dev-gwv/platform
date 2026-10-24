import type { TransactionSql } from 'postgres'
import {
  supportBotGroup,
  supportBotStatus,
  type SupportBotGroup,
  type SupportBotStatus,
  type SupportCallNotice,
  type SupportCallNoticeKind,
  type SupportWhatsappSettings,
} from '@ipc/contracts'
import type { Env } from '../context'
import { withService } from './db'
import { describeError, log } from './log'
import { sendWhatsAppTemplate, whatsappConfigured } from './whatsapp'
import { bookingFromNotice, groupHasRoom, planMessages, summaryText, type Booking, type PlannedMessage } from './support-calls'

/**
 * Support call bookings and their WhatsApp messages (0280): the database and
 * the two senders. The rules live in ./support-calls.ts.
 *
 * A notice is saved and its messages written to the outbox in one go; the
 * outbox is then drained at once and again on every five-minute messages
 * tick, which also posts the morning summary. Only platform admins see any of
 * it (modules/support-calls).
 */

export const SETTINGS_COLUMNS = `
  support_wa_official_on as official_on, support_wa_bot_on as bot_on,
  support_wa_team_numbers as team_numbers, support_wa_group_jid as group_jid,
  support_wa_group_name as group_name, support_wa_hourly_cap as hourly_cap,
  support_wa_daily_cap as daily_cap, support_wa_daily_summary as daily_summary,
  support_wa_tpl_booked as tpl_booked, support_wa_tpl_reminder as tpl_reminder,
  support_wa_tpl_cancelled as tpl_cancelled, support_wa_tpl_team as tpl_team`

export async function readSupportSettings(sql: TransactionSql): Promise<SupportWhatsappSettings> {
  const [row] = await sql.unsafe<SupportWhatsappSettings[]>(`select ${SETTINGS_COLUMNS} from platform_settings limit 1`)
  if (!row) throw new Error('platform_settings has no row')
  return { ...row, team_numbers: row.team_numbers ?? [] }
}

// ── the group bot (deploy/wa-bot) ─────────────────────────────────────────

const botBase = (env: Env) => (env.WA_BOT_URL || 'http://wa-bot:3001').replace(/\/+$/, '')

async function botFetch(env: Env, path: string, init: RequestInit = {}, timeoutMs = 8_000): Promise<Response> {
  return fetch(`${botBase(env)}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-bot-secret': env.WA_BOT_SECRET ?? '', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/** Where the bot is: off (not set up here), unreachable, waiting for its QR, or linked. */
export async function botStatus(env: Env): Promise<SupportBotStatus> {
  if (!env.WA_BOT_SECRET) return supportBotStatus.parse({ state: 'off' })
  try {
    const res = await botFetch(env, '/status', {}, 4_000)
    if (!res.ok) return supportBotStatus.parse({ state: 'unreachable' })
    return supportBotStatus.parse(await res.json())
  } catch {
    return supportBotStatus.parse({ state: 'unreachable' })
  }
}

export async function botGroups(env: Env): Promise<SupportBotGroup[]> {
  const res = await botFetch(env, '/groups', {}, 15_000)
  if (!res.ok) throw new Error(`bot groups ${res.status}`)
  return supportBotGroup.array().parse(await res.json())
}

export async function botLogout(env: Env): Promise<void> {
  const res = await botFetch(env, '/logout', { method: 'POST' })
  if (!res.ok) throw new Error(`bot logout ${res.status}`)
}

/** One post. `retry` is false when trying again cannot help (not linked, not a member, refused). */
async function botSend(env: Env, jid: string, text: string, key: string): Promise<{ ok: true; id: string } | { ok: false; error: string; retry: boolean }> {
  try {
    const res = await botFetch(env, '/send', { method: 'POST', body: JSON.stringify({ jid, text, key }) }, 30_000)
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string; retry?: boolean }
    if (res.ok) return { ok: true, id: body.id ?? '' }
    return { ok: false, error: body.error ?? `The bot answered ${res.status}.`, retry: body.retry ?? res.status >= 500 }
  } catch (err) {
    return { ok: false, error: `The bot could not be reached: ${describeError(err).message}`, retry: true }
  }
}

// ── saving a notice ───────────────────────────────────────────────────────

interface BookingRow {
  id: string
  booking_ref: string
  status: Booking['status']
  starts_at: Date
  ends_at: Date | null
  timezone: string | null
  name: string
  email: string | null
  phone: string | null
  whatsapp_ok: boolean
  meeting_url: string | null
  notes: string | null
  company_id: string | null
  studio_name: string | null
  page: string | null
}

const toBooking = (r: BookingRow): Booking => ({
  ref: r.booking_ref,
  status: r.status,
  startsAt: new Date(r.starts_at).toISOString(),
  endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
  timezone: r.timezone,
  name: r.name,
  email: r.email,
  phone: r.phone,
  whatsappOk: r.whatsapp_ok,
  meetingUrl: r.meeting_url,
  notes: r.notes,
  companyId: r.company_id,
  studioName: r.studio_name,
  page: r.page,
})

async function planName(sql: TransactionSql, companyId: string | null): Promise<string | null> {
  if (!companyId) return null
  const [row] = await sql<{ name: string | null }[]>`
    select p.name from companies c left join plans p on p.key = c.plan where c.id = ${companyId}`
  return row?.name ?? null
}

async function insertPlanned(sql: TransactionSql, bookingId: string | null, planned: PlannedMessage[]): Promise<number> {
  let n = 0
  for (const m of planned) {
    const rows = await sql`
      insert into support_call_outbox (booking_id, channel, audience, to_number, template, params, body, dedupe_key, status, last_error, send_after)
      values (${bookingId}, ${m.channel}, ${m.audience}, ${m.to}, ${m.template}, ${sql.json(m.params)}, ${m.body}, ${m.dedupeKey},
              ${m.skipped ? 'skipped' : 'queued'}, ${m.skipped}, ${m.sendAfter})
      on conflict (dedupe_key) do nothing
      returning id`
    n += rows.length
  }
  return n
}

/**
 * Save one notice and write what it sends. A notice already seen (by its id)
 * does nothing: 'duplicate'.
 */
export async function saveSupportCallNotice(env: Env, notice: SupportCallNotice, now = Date.now()): Promise<'saved' | 'duplicate'> {
  const groupWorks = (await botStatus(env)).state === 'open'
  const b = bookingFromNotice(notice)
  return withService(env, async (sql) => {
    const fresh = await sql`
      insert into support_call_events (event_id, kind, booking_ref) values (${notice.id}, ${notice.event}, ${b.ref})
      on conflict (event_id) do nothing returning event_id`
    if (!fresh.length) return 'duplicate'

    // Only a studio that exists is linked; a stray id stays as the words it came with.
    const [company] = b.companyId ? await sql<{ id: string }[]>`select id from companies where id = ${b.companyId}` : []
    const [row] = await sql<{ id: string }[]>`
      insert into support_call_bookings (booking_ref, status, starts_at, ends_at, timezone, name, email, phone, whatsapp_ok,
                                         meeting_url, notes, company_id, studio_name, page, raw)
      values (${b.ref}, ${b.status}, ${b.startsAt}, ${b.endsAt}, ${b.timezone}, ${b.name}, ${b.email}, ${b.phone}, ${b.whatsappOk},
              ${b.meetingUrl}, ${b.notes}, ${company?.id ?? null}, ${b.studioName}, ${b.page}, ${sql.json(notice as never)})
      on conflict (booking_ref) do update set
        status = excluded.status, starts_at = excluded.starts_at, ends_at = excluded.ends_at, timezone = excluded.timezone,
        name = excluded.name, email = excluded.email, phone = excluded.phone, whatsapp_ok = excluded.whatsapp_ok,
        meeting_url = excluded.meeting_url, notes = excluded.notes,
        company_id = coalesce(excluded.company_id, support_call_bookings.company_id),
        studio_name = coalesce(excluded.studio_name, support_call_bookings.studio_name),
        page = coalesce(excluded.page, support_call_bookings.page), raw = excluded.raw, updated_at = now()
      returning id`
    const bookingId = row!.id

    // A moved or cancelled call's reminder for the old time must not go out.
    if (notice.event !== 'booking.created') {
      await sql`
        update support_call_outbox
           set status = 'skipped', last_error = ${notice.event === 'booking.cancelled' ? 'The call was cancelled.' : 'The call moved.'}, updated_at = now()
         where booking_id = ${bookingId} and status = 'queued' and dedupe_key like 'booker:reminder:%'`
    }
    const [{ n: bookerSoFar } = { n: 0 }] = await sql<{ n: number }[]>`
      select count(*)::int as n from support_call_outbox
       where booking_id = ${bookingId} and audience = 'booker' and status in ('queued', 'sending', 'sent')`
    const settings = await readSupportSettings(sql)
    const planned = planMessages(notice.event, { ...b, companyId: company?.id ?? null }, settings, {
      now,
      bookerSoFar,
      groupWorks,
      plan: await planName(sql, company?.id ?? null),
    })
    await insertPlanned(sql, bookingId, planned)
    return 'saved'
  })
}

// ── sending ───────────────────────────────────────────────────────────────

interface OutboxRow {
  id: string
  booking_id: string | null
  channel: 'official' | 'group'
  audience: 'booker' | 'team' | 'group'
  to_number: string | null
  template: string | null
  params: string[]
  body: string | null
  dedupe_key: string
  attempts: number
}

const MAX_ATTEMPTS = 3
/** The bot also waits between posts; this keeps the API from queueing them all at once. */
const GROUP_GAP_MS = () => 4_000 + Math.floor(Math.random() * 6_000)
const KIND_FROM_WORD: Record<string, SupportCallNoticeKind> = { booked: 'booking.created', moved: 'booking.rescheduled', cancelled: 'booking.cancelled' }

async function finish(env: Env, id: string, patch: { status: 'sent' | 'failed' | 'skipped' | 'queued'; error?: string | null; providerId?: string | null; retryInMs?: number }) {
  await withService(env, (sql) => sql`
    update support_call_outbox
       set status = ${patch.status}, last_error = ${patch.error ?? null}, provider_id = coalesce(${patch.providerId ?? null}, provider_id),
           sent_at = case when ${patch.status} = 'sent' then now() else sent_at end,
           send_after = case when ${patch.status} = 'queued' then now() + make_interval(secs => ${Math.round((patch.retryInMs ?? 0) / 1000)}) else send_after end,
           updated_at = now()
     where id = ${id}`)
}

/** When the group cannot be used, the team's own numbers hear instead. */
async function fallBackToTeam(env: Env, row: OutboxRow, settings: SupportWhatsappSettings): Promise<boolean> {
  if (!row.booking_id || !settings.official_on || !settings.team_numbers.length) return false
  const word = row.dedupe_key.split(':')[1] ?? ''
  const kind = KIND_FROM_WORD[word]
  if (!kind) return false
  return withService(env, async (sql) => {
    const [b] = await sql<BookingRow[]>`select * from support_call_bookings where id = ${row.booking_id}`
    if (!b) return false
    const team = planMessages(kind, toBooking(b), { ...settings, bot_on: false }, { now: Date.now(), bookerSoFar: 0, groupWorks: false }).filter(
      (m) => m.audience === 'team',
    )
    return (await insertPlanned(sql, row.booking_id, team)) > 0
  })
}

async function sendOfficial(env: Env, row: OutboxRow, settings: SupportWhatsappSettings): Promise<void> {
  if (!settings.official_on) return finish(env, row.id, { status: 'skipped', error: 'Official messages are off.' })
  if (!whatsappConfigured(env)) return finish(env, row.id, { status: 'failed', error: 'The WhatsApp API is not set up on the server.' })
  if (!row.to_number || !row.template) return finish(env, row.id, { status: 'failed', error: 'No number or template.' })
  if (row.audience === 'booker' && row.booking_id && !row.dedupe_key.startsWith('booker:cancelled:')) {
    const still = await withService(env, async (sql) => (await sql<{ status: string }[]>`select status from support_call_bookings where id = ${row.booking_id}`)[0])
    if (still?.status === 'cancelled') return finish(env, row.id, { status: 'skipped', error: 'The call was cancelled.' })
  }
  try {
    const r = await sendWhatsAppTemplate(env, row.to_number, { name: row.template, language: 'en' }, row.params)
    await finish(env, row.id, { status: 'sent', providerId: r.message_id })
  } catch (err) {
    const error = describeError(err).message.slice(0, 300)
    await finish(env, row.id, row.attempts < MAX_ATTEMPTS ? { status: 'queued', error, retryInMs: row.attempts * 5 * 60_000 } : { status: 'failed', error })
  }
}

async function sendGroup(env: Env, row: OutboxRow, settings: SupportWhatsappSettings): Promise<'posted' | 'held' | 'other'> {
  if (!settings.bot_on || !settings.group_jid) {
    const moved = await fallBackToTeam(env, row, settings)
    await finish(env, row.id, { status: 'skipped', error: moved ? 'The group bot is off; sent to the team numbers instead.' : 'The group bot is off.' })
    return 'other'
  }
  const counts = await withService(env, async (sql) => (await sql<{ hour: number; day: number }[]>`
    select count(*) filter (where sent_at > now() - interval '1 hour')::int as hour,
           count(*) filter (where sent_at > now() - interval '24 hours')::int as day
      from support_call_outbox where channel = 'group' and status = 'sent'`)[0])
  if (!groupHasRoom(counts?.hour ?? 0, counts?.day ?? 0, settings)) {
    // Holding back is the point of the cap: it waits, it does not go elsewhere.
    await finish(env, row.id, { status: 'queued', error: 'Waiting: the group has had its posts for now.', retryInMs: 15 * 60_000 })
    return 'held'
  }
  const r = await botSend(env, settings.group_jid, row.body ?? '', row.dedupe_key)
  if (r.ok) {
    await finish(env, row.id, { status: 'sent', providerId: r.id })
    return 'posted'
  }
  if (r.retry && row.attempts < MAX_ATTEMPTS) {
    await finish(env, row.id, { status: 'queued', error: r.error, retryInMs: row.attempts * 2 * 60_000 })
    return 'other'
  }
  const moved = await fallBackToTeam(env, row, settings)
  await finish(env, row.id, { status: 'failed', error: moved ? `${r.error} Sent to the team numbers instead.` : r.error })
  return 'other'
}

/** Send what is due. Two runs at once never take the same message. */
export async function drainSupportCalls(env: Env): Promise<{ sent: number; failed: number; held: number }> {
  const { rows, settings } = await withService(env, async (sql) => {
    // A run that died mid-send leaves 'sending'; after ten minutes it is due again.
    await sql`update support_call_outbox set status = 'queued', updated_at = now() where status = 'sending' and updated_at < now() - interval '10 minutes'`
    const claimed = await sql<OutboxRow[]>`
      update support_call_outbox set status = 'sending', attempts = attempts + 1, updated_at = now()
       where id in (select id from support_call_outbox where status = 'queued' and send_after <= now()
                     order by send_after limit 20 for update skip locked)
      returning id, booking_id, channel, audience, to_number, template, params, body, dedupe_key, attempts`
    return { rows: claimed, settings: await readSupportSettings(sql) }
  })
  let posted = 0
  let held = 0
  for (const row of rows) {
    try {
      if (row.channel === 'official') await sendOfficial(env, row, settings)
      else {
        if (posted > 0) await new Promise((r) => setTimeout(r, GROUP_GAP_MS()))
        const r = await sendGroup(env, row, settings)
        if (r === 'posted') posted++
        if (r === 'held') held++
      }
    } catch (err) {
      log.error({ err: describeError(err), id: row.id }, 'support call message failed')
      await finish(env, row.id, { status: 'queued', error: 'Something went wrong; trying again.', retryInMs: 5 * 60_000 }).catch(() => {})
    }
  }
  const done = await withService(env, async (sql) => (await sql<{ sent: number; failed: number }[]>`
    select count(*) filter (where status = 'sent')::int as sent, count(*) filter (where status = 'failed')::int as failed
      from support_call_outbox where id = any(${rows.map((r) => r.id)}::uuid[])`)[0])
  return { sent: done?.sent ?? 0, failed: done?.failed ?? 0, held }
}

/** India's date and hour now. */
function indiaNow(now: number): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? ''
  return { date: `${p('year')}-${p('month')}-${p('day')}`, hour: Number(p('hour')) }
}

/** From 9 am India time, once a day, the day's calls in the group -- only when there are any. */
export async function queueDailySummary(env: Env, now = Date.now()): Promise<boolean> {
  const { date, hour } = indiaNow(now)
  if (hour < 9) return false
  return withService(env, async (sql) => {
    const s = await readSupportSettings(sql)
    if (!s.daily_summary || !s.bot_on || !s.group_jid) return false
    const calls = await sql<{ starts_at: Date; name: string; studio_name: string | null }[]>`
      select starts_at, name, studio_name from support_call_bookings
       where status <> 'cancelled' and (starts_at at time zone 'Asia/Kolkata')::date = ${date}::date
       order by starts_at`
    if (!calls.length) return false
    const body = summaryText(calls.map((c) => ({ startsAt: new Date(c.starts_at).toISOString(), name: c.name, studioName: c.studio_name })))
    const rows = await sql`
      insert into support_call_outbox (channel, audience, to_number, body, dedupe_key)
      values ('group', 'group', ${s.group_jid}, ${body}, ${`summary:${date}`})
      on conflict (dedupe_key) do nothing returning id`
    return rows.length > 0
  })
}

/** A test post or template, from the Platform page. Goes through the same outbox and caps. */
export async function queueTest(env: Env, target: 'group' | 'team'): Promise<string> {
  return withService(env, async (sql) => {
    const s = await readSupportSettings(sql)
    const key = `test:${target}:${Date.now()}`
    if (target === 'group') {
      if (!s.group_jid) throw new Error('Pick the group first.')
      await sql`
        insert into support_call_outbox (channel, audience, to_number, body, dedupe_key)
        values ('group', 'group', ${s.group_jid}, ${'✅ Test from Studio AutoPilot: support call alerts will appear here.'}, ${key})`
    } else {
      const to = s.team_numbers[0]
      if (!to) throw new Error('Add a team number first.')
      await sql`
        insert into support_call_outbox (channel, audience, to_number, template, params, dedupe_key)
        values ('official', 'team', ${to}, ${s.tpl_team}, ${sql.json(['test', 'Test person', 'Studio AutoPilot', 'now', '-'])}, ${key})`
    }
    return key
  })
}
