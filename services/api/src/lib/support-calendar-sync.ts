import type { SupportCallNotice } from '@ipc/contracts'
import type { Env } from '../context'
import { withService } from './db'
import { describeError } from './log'
import { saveSupportCallNotice } from './support-call-store'
import { diffCalendar, noticeFor, parseIcs, personOf, type CalendarChange } from './support-calendar'

/**
 * Read the support calls calendar (0283) and turn what changed into bookings,
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

async function setStatus(env: Env, patch: { error: string | null; primed?: boolean }) {
  await withService(env, (sql) => sql`
    update platform_settings
       set support_ical_checked_at = now(), support_ical_error = ${patch.error},
           support_ical_primed = coalesce(${patch.primed ?? null}, support_ical_primed), updated_at = now()`)
}

export async function syncSupportCalendar(env: Env, now = Date.now()): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = { ran: false, error: null, booked: 0, moved: 0, cancelled: 0 }
  const settings = await withService(env, async (sql) => {
    const [s] = await sql<{ url: string | null; primed: boolean }[]>`
      select support_ical_url as url, support_ical_primed as primed from platform_settings limit 1`
    return s ?? null
  })
  if (!settings?.url) return result
  result.ran = true

  let text: string
  try {
    const res = await fetch(settings.url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'text/calendar' } })
    if (!res.ok) {
      result.error =
        res.status === 404 || res.status === 403
          ? `The calendar refused the address (${res.status}). Copy the "Secret address in iCal format" again.`
          : `The calendar answered ${res.status}. Trying again in five minutes.`
      await setStatus(env, { error: result.error })
      return result
    }
    text = await res.text()
  } catch (err) {
    result.error = `The calendar could not be reached: ${describeError(err).message.slice(0, 120)}`
    await setStatus(env, { error: result.error })
    return result
  }
  const events = parseIcs(text)
  if (!events) {
    result.error = 'That address did not give a calendar. Use the "Secret address in iCal format".'
    await setStatus(env, { error: result.error })
    return result
  }

  const known = await withService(env, async (sql) =>
    (
      await sql<{ ref: string; starts_at: Date }[]>`
        select booking_ref as ref, starts_at from support_call_bookings
         where booking_ref like 'gcal:%' and status <> 'cancelled' and starts_at > now()`
    ).map((k) => ({ ref: k.ref, startsAt: new Date(k.starts_at).toISOString() })),
  )
  const changes: CalendarChange[] = diffCalendar(events, known, now)
  const quiet = settings.primed ? undefined : FIRST_READ
  for (const change of changes) {
    const notice = 'event' in change ? noticeFor(change, await studioByEmail(env, personOf(change.event).email)) : await cancelledNotice(env, change.ref)
    if (!notice) continue
    const saved = await saveSupportCallNotice(env, notice, now, quiet)
    if (saved !== 'saved') continue
    if (change.kind === 'booking.created') result.booked++
    else if (change.kind === 'booking.rescheduled') result.moved++
    else result.cancelled++
  }
  await setStatus(env, { error: null, primed: true })
  return result
}
