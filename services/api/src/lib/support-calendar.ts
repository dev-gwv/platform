import type { SupportCallNotice, SupportCallNoticeKind } from '@ipc/contracts'

/**
 * Support calls read from a Google Calendar (0283): the parts with no network
 * or database, so every rule is tested.
 *
 * The calendar is one used only for support calls (whichever booking page
 * fills it -- a Google Calendar appointment schedule), read through
 * its private iCal address every five minutes. Each entry is a booking: new is
 * "booked", a changed time is "moved", removed or cancelled is "cancelled".
 */

export interface CalEvent {
  uid: string
  startsAt: string
  endsAt: string | null
  summary: string
  description: string
  status: string
  organizer: string | null
  attendees: { email: string; name: string | null }[]
  meetingUrl: string | null
}

/** How far ahead entries count, and how long a started call is still news. */
const AHEAD_MS = 60 * 24 * 3600_000
const BEHIND_MS = 3600_000

/** iCal text values escape commas, semicolons, backslashes and line breaks. */
const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

/** The UTC instant of a wall-clock time in a time zone (Asia/Kolkata, Europe/London…). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s)
  let guess = asUtc
  // Twice is enough for any real offset change.
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(guess))
    const p = (t: string) => Number(parts.find((x) => x.type === t)?.value)
    const wall = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'))
    guess += asUtc - wall
  }
  return new Date(guess)
}

/** DTSTART / DTEND to an ISO instant; null for an all-day date (not a call). */
function instant(params: string, value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  const n = [y, mo, d, h, mi, s].map(Number) as [number, number, number, number, number, number]
  if (z) return new Date(Date.UTC(n[0], n[1] - 1, n[2], n[3], n[4], n[5])).toISOString()
  const tz = /TZID=([^;:]+)/.exec(params)?.[1]?.replace(/^"|"$/g, '')
  try {
    return zonedToUtc(...n, tz || 'Asia/Kolkata').toISOString()
  } catch {
    return zonedToUtc(...n, 'Asia/Kolkata').toISOString()
  }
}

const mailto = (v: string) => /mailto:([^\s;]+)/i.exec(v)?.[1]?.toLowerCase() ?? null
const cn = (params: string) => /CN=("([^"]*)"|[^;:]*)/i.exec(params)?.[2] ?? /CN=([^;:]*)/i.exec(params)?.[1] ?? null

/** The events of an iCal feed, or null when the text is not a calendar at all. */
export function parseIcs(text: string): CalEvent[] | null {
  if (!/BEGIN:VCALENDAR/.test(text)) return null
  // Long lines are folded onto the next line after a space or tab.
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const out: CalEvent[] = []
  let cur: (Partial<CalEvent> & { attendees: CalEvent['attendees']; recurring?: boolean; allDay?: boolean }) | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = { attendees: [], description: '', summary: '', status: '' }
      continue
    }
    if (line === 'END:VEVENT') {
      if (cur?.uid && cur.startsAt && !cur.recurring && !cur.allDay) {
        const text = `${cur.description ?? ''}\n${cur.meetingUrl ?? ''}`
        out.push({
          uid: cur.uid,
          startsAt: cur.startsAt,
          endsAt: cur.endsAt ?? null,
          summary: cur.summary ?? '',
          description: cur.description ?? '',
          status: (cur.status ?? '').toUpperCase(),
          organizer: cur.organizer ?? null,
          attendees: cur.attendees,
          meetingUrl: /https:\/\/meet\.google\.com\/[a-z0-9-]+/i.exec(text)?.[0] ?? (cur.meetingUrl?.startsWith('https://') ? cur.meetingUrl : null),
        })
      }
      cur = null
      continue
    }
    if (!cur) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const head = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const semi = head.indexOf(';')
    const name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase()
    const params = semi < 0 ? '' : head.slice(semi + 1)
    switch (name) {
      case 'UID':
        cur.uid = value.trim()
        break
      case 'DTSTART': {
        const at = instant(params, value)
        if (at) cur.startsAt = at
        else cur.allDay = true
        break
      }
      case 'DTEND':
        cur.endsAt = instant(params, value)
        break
      case 'SUMMARY':
        cur.summary = unescape(value).trim()
        break
      case 'DESCRIPTION':
        // Google writes some descriptions as HTML; the group gets plain words.
        cur.description = unescape(value)
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim()
        break
      case 'STATUS':
        cur.status = value.trim()
        break
      case 'ORGANIZER':
        cur.organizer = mailto(value)
        break
      case 'ATTENDEE': {
        const email = mailto(value)
        if (email) cur.attendees.push({ email, name: cn(params)?.trim() || null })
        break
      }
      case 'X-GOOGLE-CONFERENCE':
        cur.meetingUrl = value.trim()
        break
      case 'LOCATION':
        if (!cur.meetingUrl && /^https:\/\//.test(value.trim())) cur.meetingUrl = value.trim()
        break
      case 'RRULE':
        // A repeating entry is a block of time someone set, not a booking.
        cur.recurring = true
        break
    }
  }
  return out
}

/** Who booked: the first guest who is not the calendar's own person. */
export function personOf(e: CalEvent): { name: string; email: string | null } {
  const guest = e.attendees.find((a) => a.email !== e.organizer) ?? null
  const name =
    guest?.name ||
    // "Support call (Asha Rao)" or "Asha Rao and Harsh Solanki"
    /\(([^)]+)\)\s*$/.exec(e.summary)?.[1] ||
    guest?.email.split('@')[0] ||
    e.summary ||
    'Someone'
  return { name: name.trim(), email: guest?.email ?? null }
}

export interface KnownBooking {
  ref: string
  startsAt: string
}

export type CalendarChange = { kind: SupportCallNoticeKind; event: CalEvent } | { kind: 'booking.cancelled'; ref: string; startsAt: string }

/**
 * A booking's ref: the calendar's prefix and the event's uid. Slot 1 keeps
 * 0283's plain "gcal:" so its bookings stay matched; slot 2 is "gcal2:", so
 * reading one person's calendar never cancels the other's calls.
 */
export const refPrefix = (slot = 1) => (slot === 1 ? 'gcal:' : `gcal${slot}:`)
export const refOf = (uid: string, slot = 1) => `${refPrefix(slot)}${uid}`

/**
 * What changed since the last read. `known` is every calendar booking still
 * ahead and not cancelled. An empty feed never cancels anything: a calendar
 * that answered with nothing is more likely a hiccup than every call gone.
 */
export function diffCalendar(feed: CalEvent[], known: KnownBooking[], now: number, slot = 1): CalendarChange[] {
  const inWindow = feed.filter((e) => {
    const t = Date.parse(e.startsAt)
    return t >= now - BEHIND_MS && t <= now + AHEAD_MS
  })
  const byRef = new Map(known.map((k) => [k.ref, k]))
  const out: CalendarChange[] = []
  for (const e of inWindow) {
    const k = byRef.get(refOf(e.uid, slot))
    if (e.status === 'CANCELLED') {
      if (k) out.push({ kind: 'booking.cancelled', event: e })
      continue
    }
    if (!k) out.push({ kind: 'booking.created', event: e })
    else if (Math.abs(Date.parse(k.startsAt) - Date.parse(e.startsAt)) > 60_000) out.push({ kind: 'booking.rescheduled', event: e })
  }
  if (feed.length > 0) {
    const present = new Set(feed.map((e) => refOf(e.uid, slot)))
    for (const k of known) {
      if (!present.has(k.ref) && Date.parse(k.startsAt) > now) out.push({ kind: 'booking.cancelled', ref: k.ref, startsAt: k.startsAt })
    }
  }
  return out
}

/** The notice a change makes, in the shape every booking goes through. */
export function noticeFor(change: CalendarChange, studio: { id: string; name: string } | null, slot = 1): SupportCallNotice | null {
  if (!('event' in change)) return null
  const e = change.event
  const who = personOf(e)
  return {
    id: `${refOf(e.uid, slot)}:${change.kind}:${e.startsAt}`,
    event: change.kind,
    booking: {
      id: refOf(e.uid, slot),
      start: e.startsAt,
      end: e.endsAt,
      timezone: 'Asia/Kolkata',
      event_type: 'support-call',
      meeting_url: e.meetingUrl,
      notes: e.description ? e.description.slice(0, 2000) : null,
      // A calendar entry carries no "remind me on WhatsApp", so nobody is messaged personally.
      invitee: { name: who.name.slice(0, 200), email: who.email, phone: null, whatsapp_ok: false },
      utm: studio ? { source: 'google-calendar', content: studio.name, term: studio.id } : { source: 'google-calendar' },
      parent: null,
    },
  }
}

/** A Google private iCal address (or any https .ics); the page refuses anything else. */
export function looksLikeIcal(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (/\.ics$/i.test(u.pathname) || /\/calendar\/ical\//.test(u.pathname))
  } catch {
    return false
  }
}

/** "calendar.google.com/…/basic.ics": enough to recognise it, not enough to use it. */
export function maskIcal(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return `${u.host}/…${u.pathname.slice(-10)}`
  } catch {
    return '…'
  }
}
