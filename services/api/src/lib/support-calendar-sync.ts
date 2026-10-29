import type { SupportCallNotice } from '@ipc/contracts'
import type { Env } from '../context'
import { withService } from './db'
import { describeError } from './log'
import { saveSupportCallNotice } from './support-call-store'
import { diffCalendar, noticeFor, parseIcs, personOf, refPrefix, type CalendarChange } from './support-calendar'

/**
 * Read the support calls calendars (0283, two since 0290) and turn what changed into bookings,
 * through the same path as every other booking (saveSupportCallNotice), so the
 * group post, caps, outbox and log are one. Runs on the five-minute messages
 * tick and from "Check now" on Platform -> Support calls.
 *
 * The first read after an address is set only learns what is already there:
 * it saves those bookings quietly, so connecting a calendar never floods the
 * group with calls booked weeks ago.
 */
export interface CalendarSyncResult {
  ran: boolean
  error: string | null
  booked: number
  moved: number
  cancelled: number
}

const FIRST_READ = 'Already on the calendar when it was connected.'

/** The studio a booker belongs to, by the email they booked with: an owner first. */
async function studioByEmail(env: Env, email: string | null): Promise<{ id: string; name: string } | null> {
  if (!email) return null
  return withService(env, async (sql) => {
    const [row] = await sql<{ id: string; name: string }[]>`
      select c.id, coalesce(c.display_name, c.name) as name
        from users u join companies c on c.id = u.company_id
       where lower(u.email) = ${email.toLowerCase()} and u.deleted_at is null
       order by (u.role = 'super_admin') desc, u.created_at
       limit 1`
    return row ?? null
  })
}

/** A booking we knew that is gone from the calendar: cancelled, from what we kept. */
async function cancelledNotice(env: Env, ref: string): Promise<SupportCallNotice | null> {
  return withService(env, async (sql) => {
    const [b] = await sql<
      { booking_ref: string; starts_at: Date; ends_at: Date | null; name: string; email: string | null; meeting_url: string | null; company_id: string | null; studio_name: string | null }[]
    >`select booking_ref, starts_at, ends_at, name, email, meeting_url, company_id, studio_name from support_call_bookings where booking_ref = ${ref}`
    if (!b) return null
    const start = new Date(b.starts_at).toISOString()
    return {
      id: `${ref}:booking.cancelled:${start}`,
      event: 'booking.cancelled',
      booking: {
        id: ref,
        start,
        end: b.ends_at ? new Date(b.ends_at).toISOString() : null,
        meeting_url: b.meeting_url,
        invitee: { name: b.name, email: b.email, phone: null, whatsapp_ok: false },
        utm: { source: 'google-calendar', content: b.studio_name, term: b.company_id },
      },
    }
  })
}

async function setStatus(env: Env, slot: number, patch: { error: string | null; primed?: boolean }) {
  await withService(env, (sql) => sql`
    update support_calendars
       set checked_at = now(), error = ${patch.error},
           primed = coalesce(${patch.primed ?? null}, primed), updated_at = now()
     where slot = ${slot}`)
}

/** Every connected calendar (0290: one per person who takes calls), each read on its own. */
export async function syncSupportCalendar(env: Env, now = Date.now()): Promise<CalendarSyncResult> {
  const calendars = await withService(env, (sql) =>
    sql<{ slot: number; url: string; primed: boolean }[]>`
      select slot, ical_url as url, primed from support_calendars where ical_url is not null order by slot`,
  )
  const total: CalendarSyncResult = { ran: false, error: null, booked: 0, moved: 0, cancelled: 0 }
  for (const cal of calendars) {
    const r = await syncOne(env, cal, now)
    total.ran = true
    total.booked += r.booked
    total.moved += r.moved
    total.cancelled += r.cancelled
    total.error ??= r.error && (calendars.length > 1 ? `Calendar ${cal.slot}: ${r.error}` : r.error)
  }
  return total
}

async function syncOne(env: Env, cal: { slot: number; url: string; primed: boolean }, now: number): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = { ran: true, error: null, booked: 0, moved: 0, cancelled: 0 }
  const fault = async (error: string) => {
    result.error = error
    await setStatus(env, cal.slot, { error })
    return result
  }

  let text: string
  try {
    const res = await fetch(cal.url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'text/calendar' } })
    if (!res.ok) {
      return fault(
        res.status === 404 || res.status === 403
          ? `The calendar refused the address (${res.status}). Copy the "Secret address in iCal format" again.`
          : `The calendar answered ${res.status}. Trying again in five minutes.`,
      )
    }
    text = await res.text()
  } catch (err) {
    return fault(`The calendar could not be reached: ${describeError(err).message.slice(0, 120)}`)
  }
  const events = parseIcs(text)
  if (!events) return fault('That address did not give a calendar. Use the "Secret address in iCal format".')

  const prefix = refPrefix(cal.slot)
  const known = await withService(env, async (sql) =>
    (
      await sql<{ ref: string; starts_at: Date }[]>`
        select booking_ref as ref, starts_at from support_call_bookings
         where starts_with(booking_ref, ${prefix}) and status <> 'cancelled' and starts_at > now()`
    ).map((k) => ({ ref: k.ref, startsAt: new Date(k.starts_at).toISOString() })),
  )
  const changes: CalendarChange[] = diffCalendar(events, known, now, cal.slot)
  const quiet = cal.primed ? undefined : FIRST_READ
  for (const change of changes) {
    const notice =
      'event' in change
        ? noticeFor(change, await studioByEmail(env, personOf(change.event).email), cal.slot)
        : await cancelledNotice(env, change.ref)
    if (!notice) continue
    const saved = await saveSupportCallNotice(env, notice, now, quiet)
    if (saved !== 'saved') continue
    if (change.kind === 'booking.created') result.booked++
    else if (change.kind === 'booking.rescheduled') result.moved++
    else result.cancelled++
  }
  await setStatus(env, cal.slot, { error: null, primed: true })
  return result
}
