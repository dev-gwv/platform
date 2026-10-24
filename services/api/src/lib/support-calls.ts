import { normalizePhoneForWhatsApp, type SupportCallNotice, type SupportCallNoticeKind, type SupportWhatsappSettings } from '@ipc/contracts'
import { timingSafeEqual, toHex } from './crypto'

/**
 * Support call bookings and their WhatsApp messages (0280): the parts with no
 * database, so every rule here is tested.
 *
 * Why it is careful (the developer, 24 Oct: "Meta bans APIs very quickly"):
 *   * the person who booked hears from us only if they ticked WhatsApp, and
 *     at most BOOKER_CAP times per booking: confirmed, reminder, moved,
 *     cancelled -- utility templates, never promotion;
 *   * the group bot posts to one group only, slowly, within an hourly and a
 *     daily cap, plain text, one post per event;
 *   * every message has a dedupe key, so a notice sent twice is sent once;
 *   * the words are fixed templates filled from the booking. No AI writes or
 *     decides anything.
 */

/** How old a signed notice may be before it is refused, either way. */
export const SIGNATURE_TOLERANCE_S = 300
/** Messages to one person about one booking, whatever happens to it. */
export const BOOKER_CAP = 4
/** The reminder goes this long before the call. */
export const REMINDER_BEFORE_MS = 60 * 60_000

/**
 * The booking app signs each notice: header `X-Signature: t=<unix seconds>,v1=<hex>`
 * where v1 = HMAC-SHA256(secret, `${t}.${raw body}`). The timestamp keeps an
 * old notice from being replayed later.
 */
export async function verifySupportCallSignature(raw: string, header: string | undefined, secret: string | undefined, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || !header) return false
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  )
  const t = Number(parts.t)
  if (!Number.isInteger(t) || Math.abs(nowS - t) > SIGNATURE_TOLERANCE_S || !parts.v1) return false
  return timingSafeEqual(await signSupportCall(raw, secret, t), String(parts.v1).toLowerCase())
}

/** The v1 signature for a body at a time. The booking app does the same. */
export async function signSupportCall(raw: string, secret: string, t: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)))
}

export interface Booking {
  ref: string
  status: 'booked' | 'rescheduled' | 'cancelled'
  startsAt: string
  endsAt: string | null
  timezone: string | null
  name: string
  email: string | null
  phone: string | null
  whatsappOk: boolean
  meetingUrl: string | null
  notes: string | null
  companyId: string | null
  studioName: string | null
  page: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The booking a notice describes. The in-app button tags it: utm_content = studio, utm_term = studio id. */
export function bookingFromNotice(n: SupportCallNotice): Booking {
  const b = n.booking
  const phone = normalizePhoneForWhatsApp(b.invitee.phone)
  let page: string | null = null
  try {
    page = b.parent ? new URL(b.parent).pathname : null
  } catch {
    page = null
  }
  return {
    ref: b.id,
    status: n.event === 'booking.cancelled' ? 'cancelled' : n.event === 'booking.rescheduled' ? 'rescheduled' : 'booked',
    startsAt: new Date(b.start).toISOString(),
    endsAt: b.end ? new Date(b.end).toISOString() : null,
    timezone: b.timezone ?? null,
    name: b.invitee.name.trim(),
    email: b.invitee.email?.trim() || null,
    phone: /^\d{10,15}$/.test(phone) ? phone : null,
    whatsappOk: b.invitee.whatsapp_ok,
    meetingUrl: b.meeting_url ?? null,
    notes: b.notes?.trim() || null,
    companyId: b.utm?.term && UUID.test(b.utm.term) ? b.utm.term : null,
    studioName: b.utm?.content?.trim() || null,
    page,
  }
}

/** "Thu 23 Oct, 3:00–3:20 pm" in India time. */
export function istWhen(startsAt: string, endsAt?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(startsAt))
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = `${part('weekday')} ${part('day')} ${part('month')}`
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })
      .format(new Date(iso))
      .replace(/\s?([ap])\.?m\.?/i, ' $1m')
      .toLowerCase()
  const start = time(startsAt)
  if (!endsAt) return `${day}, ${start}`
  const end = time(endsAt)
  // "3:00–3:20 pm" when both are in the afternoon, "11:30 am–12:10 pm" across noon.
  const sameHalf = start.slice(-2) === end.slice(-2)
  return `${day}, ${sameHalf ? start.slice(0, -3) : start}–${end}`
}

/** Meta refuses a blank value or one with line breaks. */
export function cleanParam(v: string | null | undefined): string {
  const s = (v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim()
  return s ? s.slice(0, 1000) : '-'
}

const KIND_WORD: Record<SupportCallNoticeKind, string> = {
  'booking.created': 'booked',
  'booking.rescheduled': 'moved',
  'booking.cancelled': 'cancelled',
}

/** The group's line. Plain text, no AI, a few lines. */
export function groupText(kind: SupportCallNoticeKind, b: Booking, plan?: string | null): string {
  const head = kind === 'booking.created' ? '🎧 New support call' : kind === 'booking.rescheduled' ? '🔁 Support call moved' : '❌ Support call cancelled'
  const who = [b.name || 'Someone', [b.studioName, plan ? `(${plan})` : null].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  const lines = [head, who, istWhen(b.startsAt, b.endsAt)]
  if (kind !== 'booking.cancelled' && b.meetingUrl) lines.push(`Join: ${b.meetingUrl}`)
  if (kind !== 'booking.cancelled' && b.notes) lines.push(`Notes: ${b.notes.replace(/\s+/g, ' ').slice(0, 200)}`)
  return lines.join('\n')
}

/** The day's calls, posted once in the morning when there are any. */
export function summaryText(calls: ReadonlyArray<{ startsAt: string; name: string; studioName: string | null }>): string {
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase()
  return [`📅 Today's support calls (${calls.length})`, ...calls.map((c) => `${time(c.startsAt)} · ${c.name || 'Someone'}${c.studioName ? ` (${c.studioName})` : ''}`)].join('\n')
}

export interface PlannedMessage {
  channel: 'official' | 'group'
  audience: 'booker' | 'team' | 'group'
  to: string | null
  template: string | null
  params: string[]
  body: string | null
  dedupeKey: string
  sendAfter: string
  /** Set when the message is kept only to say why it was not sent. */
  skipped: string | null
}

/**
 * What one notice sends. `bookerSoFar` is how many messages this booking's
 * person has already had; `groupWorks` is false when the bot is off, has no
 * group, or is not linked -- then the team's own numbers get the official
 * template instead.
 */
export function planMessages(
  kind: SupportCallNoticeKind,
  b: Booking,
  s: Pick<SupportWhatsappSettings, 'official_on' | 'bot_on' | 'group_jid' | 'team_numbers' | 'tpl_booked' | 'tpl_reminder' | 'tpl_cancelled' | 'tpl_team'>,
  opts: { now: number; bookerSoFar: number; groupWorks: boolean; plan?: string | null },
): PlannedMessage[] {
  const now = new Date(opts.now).toISOString()
  const at = b.startsAt
  const when = istWhen(b.startsAt, b.endsAt)
  const out: PlannedMessage[] = []
  const msg = (m: Omit<PlannedMessage, 'sendAfter' | 'skipped'> & { sendAfter?: string; skipped?: string | null }): PlannedMessage => ({
    sendAfter: now,
    skipped: null,
    ...m,
  })

  // To the person who booked.
  const bookerWhy = !b.whatsappOk ? 'They did not ask for WhatsApp.' : !b.phone ? 'No WhatsApp number on the booking.' : !s.official_on ? 'Official messages are off.' : null
  const booker: PlannedMessage[] = []
  if (kind === 'booking.cancelled') {
    booker.push(msg({ channel: 'official', audience: 'booker', to: b.phone, template: s.tpl_cancelled, params: [cleanParam(b.name), cleanParam(when)], body: null, dedupeKey: `booker:cancelled:${b.ref}` }))
  } else {
    booker.push(
      msg({
        channel: 'official',
        audience: 'booker',
        to: b.phone,
        template: s.tpl_booked,
        params: [cleanParam(b.name), cleanParam(when), cleanParam(b.meetingUrl)],
        body: null,
        dedupeKey: kind === 'booking.created' ? `booker:booked:${b.ref}` : `booker:moved:${b.ref}:${at}`,
      }),
    )
    const remindAt = Date.parse(at) - REMINDER_BEFORE_MS
    // A call booked for within the hour needs no reminder on top of its confirmation.
    if (remindAt > opts.now + 5 * 60_000) {
      booker.push(
        msg({
          channel: 'official',
          audience: 'booker',
          to: b.phone,
          template: s.tpl_reminder,
          params: [cleanParam(b.name), cleanParam(when), cleanParam(b.meetingUrl)],
          body: null,
          dedupeKey: `booker:reminder:${b.ref}:${at}`,
          sendAfter: new Date(remindAt).toISOString(),
        }),
      )
    }
  }
  booker.forEach((m, i) => {
    const why = bookerWhy ?? (opts.bookerSoFar + i >= BOOKER_CAP ? `Already ${BOOKER_CAP} messages for this booking.` : null)
    out.push(why ? { ...m, skipped: why } : m)
  })

  // To the support team: the group, else each person's own number.
  const word = KIND_WORD[kind]
  if (s.bot_on && s.group_jid && opts.groupWorks) {
    out.push(msg({ channel: 'group', audience: 'group', to: s.group_jid, template: null, params: [], body: groupText(kind, b, opts.plan), dedupeKey: `group:${word}:${b.ref}:${at}` }))
  } else if (s.official_on && s.team_numbers.length) {
    for (const n of s.team_numbers) {
      out.push(
        msg({
          channel: 'official',
          audience: 'team',
          to: n,
          template: s.tpl_team,
          params: [cleanParam(word), cleanParam(b.name), cleanParam(b.studioName ?? 'Studio AutoPilot'), cleanParam(when), cleanParam(b.meetingUrl)],
          body: null,
          dedupeKey: `team:${word}:${b.ref}:${at}:${n}`,
        }),
      )
    }
  } else {
    out.push(
      msg({
        channel: 'group',
        audience: 'group',
        to: null,
        template: null,
        params: [],
        body: groupText(kind, b, opts.plan),
        dedupeKey: `group:${word}:${b.ref}:${at}`,
        skipped: 'The group bot and the team numbers are both off.',
      }),
    )
  }
  return out
}

/** Whether the group may have one more post now. */
export function groupHasRoom(sentLastHour: number, sentToday: number, s: Pick<SupportWhatsappSettings, 'hourly_cap' | 'daily_cap'>): boolean {
  return sentLastHour < s.hourly_cap && sentToday < s.daily_cap
}

/**
 * A made-up booking for Platform -> Support calls' "Try a sample booking": the
 * whole path (saved, planned, posted in the group) without the booking app.
 * It never asks for WhatsApp, so nobody is messaged personally; only the group
 * (or, with the bot off, the team numbers) hears of it.
 */
export function sampleNotice(now = Date.now()): SupportCallNotice {
  // Two hours ahead, on the half hour, twenty minutes long.
  const start = Math.ceil((now + 2 * 3600_000) / 1_800_000) * 1_800_000
  const id = `sample-${now}`
  return {
    id,
    event: 'booking.created',
    booking: {
      id,
      start: new Date(start).toISOString(),
      end: new Date(start + 20 * 60_000).toISOString(),
      timezone: 'Asia/Kolkata',
      event_type: 'support-call',
      meeting_url: 'https://meet.google.com/sample-only',
      notes: 'A sample from Platform → Support calls. Nobody booked this.',
      invitee: { name: 'Sample booking', email: null, phone: null, whatsapp_ok: false },
      utm: { source: 'studioautopilot', medium: 'platform', campaign: 'sample', content: 'Sample Studio' },
      parent: null,
    },
  }
}

/** "••••3210": enough to tell numbers apart on the Platform page. */
export const maskNumber = (n: string | null): string | null => (n ? `••••${n.slice(-4)}` : null)
