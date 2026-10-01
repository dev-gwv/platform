import type { ShootListItem, TeamMember, TeamSlot } from '@ipc/contracts'

/**
 * The rules behind assigning crew to a shoot, kept out of the dialogs so they
 * can be tested on their own: how full each requirement is, who is free at a
 * given time, who fits a role, and what to pre-fill as their payout.
 *
 * A booking is a window (start → end). A person is busy when any of their
 * live bookings -- on this shoot or any other -- overlaps it, optionally with
 * a travel/rest buffer either side.
 */

export interface RequirementFill {
  name: string
  required: number
  assigned: number
  open: number
}

const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** A booking that still counts: released and cancelled seats are open again. */
export const isLive = (s: TeamSlot) => s.status === 'booked'

/** How full each of a shoot's requirements is, in the shoot's own order. */
export function requirementFill(shoot: Pick<ShootListItem, 'requirements'>, slots: readonly TeamSlot[]): RequirementFill[] {
  const count = new Map<string, number>()
  for (const s of slots) {
    if (!isLive(s)) continue
    count.set(key(s.service_name), (count.get(key(s.service_name)) ?? 0) + 1)
  }
  return shoot.requirements.map((r) => {
    const required = Math.max(1, r.quantity)
    const assigned = count.get(key(r.name)) ?? 0
    return { name: r.name, required, assigned, open: Math.max(0, required - assigned) }
  })
}

/** Seats filled against seats needed, never counting an over-filled role twice. */
export function shootProgress(fill: readonly RequirementFill[]) {
  const required = fill.reduce((n, r) => n + r.required, 0)
  const assigned = fill.reduce((n, r) => n + Math.min(r.assigned, r.required), 0)
  return { required, assigned, pct: required === 0 ? 0 : Math.round((assigned / required) * 100) }
}

export interface TimeWindow {
  start: string
  end: string
}

/** A local date + "HH:MM" + hours, as an ISO window. Null when incomplete. */
export function windowOf(date: string, time: string, hours: number): TimeWindow | null {
  if (!date || !/^\d{2}:\d{2}/.test(time) || !(hours > 0)) return null
  const start = new Date(`${date}T${time.slice(0, 5)}:00`)
  if (Number.isNaN(start.getTime())) return null
  const end = new Date(start.getTime() + hours * 3_600_000)
  return { start: start.toISOString(), end: end.toISOString() }
}

const pad = (n: number) => String(n).padStart(2, '0')
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** How long a shoot runs, in hours (to the half hour), or null when it has no end. */
export function shootHours(shoot: Pick<ShootListItem, 'start_at' | 'end_at'>): number | null {
  if (!shoot.start_at || !shoot.end_at) return null
  const ms = Date.parse(shoot.end_at) - Date.parse(shoot.start_at)
  return ms > 0 ? Math.round((ms / 3_600_000) * 2) / 2 : null
}

/**
 * Where a new booking on this shoot starts by default: the shoot's own day,
 * start and hours. A shoot without a start is offered its day at 9am; one
 * without an end has no hours -- the caller asks, rather than assuming four
 * (the silent four used to hide that nobody had said how long the day was).
 */
export function defaultWindowFields(
  shoot: Pick<ShootListItem, 'shoot_date' | 'start_at' | 'end_at'>,
  today: string = localDate(new Date()),
): { date: string; time: string; hours: number | null } {
  if (shoot.start_at) {
    const s = new Date(shoot.start_at)
    return { date: localDate(s), time: localTime(s), hours: shootHours(shoot) }
  }
  return { date: shoot.shoot_date ?? today, time: '09:00', hours: null }
}

/** The editable fields of an existing booking, for "Change" to keep its hours. */
export function fieldsOfSlot(slot: Pick<TeamSlot, 'start_at' | 'end_at'>) {
  const s = new Date(slot.start_at)
  const e = new Date(slot.end_at)
  return {
    date: localDate(s),
    time: localTime(s),
    hours: Math.max(0.5, Math.round(((e.getTime() - s.getTime()) / 3_600_000) * 2) / 2),
  }
}

/** Do two windows clash, allowing `bufferMin` of travel or rest between them? */
export function overlaps(a: TimeWindow, b: TimeWindow, bufferMin = 0): boolean {
  const buf = Math.max(0, bufferMin) * 60_000
  const aS = Date.parse(a.start)
  const aE = Date.parse(a.end)
  const bS = Date.parse(b.start)
  const bE = Date.parse(b.end)
  return !(aS >= bE + buf || aE + buf <= bS)
}

/**
 * The gap between two windows in minutes: how much time is free between
 * them, negative when they overlap. Zero means back to back.
 */
export function gapBetween(a: TimeWindow, b: TimeWindow): number {
  const aS = Date.parse(a.start)
  const aE = Date.parse(a.end)
  const bS = Date.parse(b.start)
  const bE = Date.parse(b.end)
  if (aS >= bE) return (aS - bE) / 60_000
  if (bS >= aE) return (bS - aE) / 60_000
  // Overlapping: how deep, as a negative number of minutes.
  return (Math.max(aS, bS) - Math.min(aE, bE)) / 60_000
}

/**
 * The booking nearest to this window among the person's live ones -- the one
 * that decides whether they can take it. `gapMin` is the free time between
 * the two, negative when they overlap. Only bookings closer than `bufferMin`
 * count; back to back with no buffer is not a clash at all.
 * `ignoreSlotId` leaves out the booking being changed, so moving a person's
 * own slot is never reported as clashing with itself.
 */
export function nearestClash(
  userId: string,
  window: TimeWindow,
  slots: readonly TeamSlot[],
  { bufferMin = 0, ignoreSlotId }: { bufferMin?: number; ignoreSlotId?: string | undefined } = {},
): { slot: TeamSlot; gapMin: number } | null {
  let best: { slot: TeamSlot; gapMin: number } | null = null
  for (const s of slots) {
    if (s.user_id !== userId || !isLive(s) || s.id === ignoreSlotId) continue
    const theirs = { start: s.start_at, end: s.end_at }
    if (!overlaps(window, theirs, bufferMin)) continue
    const gapMin = gapBetween(window, theirs)
    if (!best || gapMin < best.gapMin) best = { slot: s, gapMin }
  }
  return best
}

/** The booking that makes this person unavailable for the window, if any. */
export function clashFor(
  userId: string,
  window: TimeWindow,
  slots: readonly TeamSlot[],
  opts: { bufferMin?: number; ignoreSlotId?: string | undefined } = {},
): TeamSlot | null {
  return nearestClash(userId, window, slots, opts)?.slot ?? null
}

/** When this person is free again after a booking: its end plus the gap. */
export function freeFrom(slot: Pick<TeamSlot, 'end_at'>, bufferMin = 0): string {
  return new Date(Date.parse(slot.end_at) + Math.max(0, bufferMin) * 60_000).toISOString()
}

/** The calendar day an instant falls on, where the viewer is. */
export const localDay = (iso: string) => localDate(new Date(iso))

/** A day's worth of hours anyone can be booked: on shooting days nobody sleeps. */
export const DAY_CAPACITY_HOURS = 24

export interface DayLoad {
  /** Hours already booked on that day, across every project. */
  hours: number
  /** Those bookings, earliest first. */
  slots: TeamSlot[]
  /** Of the 24, what is still free. */
  left: number
}

/**
 * How full someone's day already is: every live booking that touches the
 * day (one that runs past midnight counts on both days, only the part on
 * this day), so "19 h left" is honest about a 5 h wedding already on it.
 */
export function dayLoad(
  userId: string,
  day: string,
  slots: readonly TeamSlot[],
  { ignoreSlotId }: { ignoreSlotId?: string | undefined } = {},
): DayLoad {
  const dayStart = new Date(`${day}T00:00:00`).getTime()
  const dayEnd = dayStart + 24 * 3_600_000
  const mine = slots
    .filter((s) => s.user_id === userId && isLive(s) && s.id !== ignoreSlotId)
    .filter((s) => Date.parse(s.start_at) < dayEnd && Date.parse(s.end_at) > dayStart)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
  const hours = mine.reduce((n, s) => {
    const from = Math.max(Date.parse(s.start_at), dayStart)
    const to = Math.min(Date.parse(s.end_at), dayEnd)
    return n + Math.max(0, to - from) / 3_600_000
  }, 0)
  const rounded = Math.round(hours * 2) / 2
  return { hours: rounded, slots: mine, left: Math.max(0, DAY_CAPACITY_HOURS - rounded) }
}

/**
 * Whether someone's job roles fit a requirement. Loose on purpose: a
 * "Photographer" suits "Candid Photographer" and the other way round, since
 * studios name roles more and less specifically than each other.
 */
export function roleMatches(member: Pick<TeamMember, 'role_names'>, requirement: string): boolean {
  const want = key(requirement)
  if (!want) return false
  return member.role_names.some((r) => {
    const have = key(r)
    return !!have && (have.includes(want) || want.includes(have))
  })
}

export type Availability =
  | { state: 'free' }
  | { state: 'on_role' } // already holds a seat of this requirement on this shoot
  /** Free, but with less than the travel/rest gap before or after another booking. Still bookable. */
  | { state: 'tight'; slot: TeamSlot; gapMin: number }
  | { state: 'busy'; slot: TeamSlot; onThisShoot: boolean }

export interface Candidate {
  member: TeamMember
  match: boolean
  availability: Availability
}

/** Whether a pick with this availability can go ahead (the database refuses only true overlaps). */
export const canPick = (a: Availability) => a.state === 'free' || a.state === 'tight'

/**
 * Everyone, sorted for picking someone for `requirement` at `window`: free
 * people whose job role fits first, then other free people, then the ones
 * with only a tight gap, then those who cannot take it -- with the reason,
 * rather than silently leaving them out, so "why is Rahul not in the list?"
 * answers itself.
 */
export function candidatesFor({
  members,
  requirement,
  window,
  shootId,
  slots,
  bufferMin = 0,
  ignoreSlotId,
}: {
  members: readonly TeamMember[]
  requirement: string
  window: TimeWindow | null
  shootId: string
  slots: readonly TeamSlot[]
  bufferMin?: number
  ignoreSlotId?: string | undefined
}): Candidate[] {
  const onRole = new Set(
    slots
      .filter((s) => isLive(s) && s.shoot_id === shootId && key(s.service_name) === key(requirement) && s.id !== ignoreSlotId)
      .map((s) => s.user_id),
  )
  const rank = (c: Candidate) => {
    const fit = c.match ? 0 : 1
    if (c.availability.state === 'free') return fit
    if (c.availability.state === 'tight') return 2 + fit
    return 4
  }
  return members
    .map((member): Candidate => {
      const match = roleMatches(member, requirement)
      if (onRole.has(member.user_id)) return { member, match, availability: { state: 'on_role' } }
      const hit = window ? nearestClash(member.user_id, window, slots, { bufferMin, ignoreSlotId }) : null
      if (!hit) return { member, match, availability: { state: 'free' } }
      if (hit.gapMin >= 0) return { member, match, availability: { state: 'tight', slot: hit.slot, gapMin: hit.gapMin } }
      return { member, match, availability: { state: 'busy', slot: hit.slot, onThisShoot: hit.slot.shoot_id === shootId } }
    })
    .sort((a, b) => rank(a) - rank(b) || a.member.name.localeCompare(b.member.name))
}

/** "4 PM", "4:30 PM". */
export function timeLabel(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const h = get('hour')
  const m = get('minute')
  const p = get('dayPeriod').toUpperCase()
  return m === '00' ? `${h} ${p}` : `${h}:${m} ${p}`
}

/** "4–9 PM · 5 h", or "11 AM–3 PM · 4 h" when the halves of the day differ. */
export function rangeLabel(window: TimeWindow, timeZone?: string): string {
  const a = timeLabel(window.start, timeZone)
  const b = timeLabel(window.end, timeZone)
  const hours = Math.round(((Date.parse(window.end) - Date.parse(window.start)) / 3_600_000) * 2) / 2
  const half = (s: string) => s.slice(-2)
  const left = half(a) === half(b) ? a.slice(0, -3) : a
  const h = Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
  return `${left}–${b} · ${h} h`
}

/** What a booking is for, in the fewest words: the shoot, else "blocked". */
export function slotName(slot: Pick<TeamSlot, 'shoot_name' | 'shoot_id' | 'service_name'>): string {
  if (slot.shoot_name) return slot.shoot_name
  if (!slot.shoot_id) return slot.service_name ?? 'blocked time'
  return slot.service_name ?? 'another shoot'
}

export interface AvailabilityLine {
  tone: 'green' | 'amber' | 'muted'
  text: string
}

/**
 * One line under a name that says whether they can take this window, in the
 * studio's words. Free people also hear what else is on their day and how
 * many of the 24 hours are left, so the planner sees the whole day at once.
 */
export function availabilityLine(
  c: Pick<Candidate, 'availability'>,
  load: DayLoad,
  windowHours: number,
  bufferMin: number,
  timeZone?: string,
): AvailabilityLine {
  const a = c.availability
  const t = (iso: string) => timeLabel(iso, timeZone)
  const span = (s: Pick<TeamSlot, 'start_at' | 'end_at'>) => `${t(s.start_at)}–${t(s.end_at)}`
  const gapText = bufferMin >= 60 ? `${Number.isInteger(bufferMin / 60) ? bufferMin / 60 : (bufferMin / 60).toFixed(1)} h` : `${bufferMin} min`
  if (a.state === 'on_role') return { tone: 'muted', text: 'Already on this role' }
  if (a.state === 'busy') {
    if (a.onThisShoot) return { tone: 'muted', text: `Already on this shoot as ${a.slot.service_name ?? 'another role'}` }
    return { tone: 'muted', text: `Busy ${span(a.slot)}, ${slotName(a.slot)} · free from ${t(freeFrom(a.slot, bufferMin))}` }
  }
  if (a.state === 'tight') {
    return {
      tone: 'amber',
      text: `Tight · only ${Math.round(a.gapMin)} min from ${slotName(a.slot)} (${span(a.slot)}), needs ${gapText}`,
    }
  }
  if (load.left < windowHours) {
    return { tone: 'amber', text: `Only ${load.left} h left today · ${load.slots.map((s) => `${span(s)} ${slotName(s)}`).join(', ')}` }
  }
  if (load.slots.length === 0) return { tone: 'green', text: 'Free all day' }
  return {
    tone: 'green',
    text: `Free · also ${load.slots.map((s) => `${span(s)}, ${slotName(s)}`).join('; ')} · ${load.left} h left`,
  }
}

/**
 * The payout to pre-fill for a booking: a freelancer's saved rate. Salaried
 * people are paid monthly, so nothing is pre-filled for them.
 */
export function suggestedPayout(member: Pick<TeamMember, 'freelancer_rate' | 'payout_type' | 'engagement_type'>): number | null {
  if (member.payout_type === 'salary') return null
  if (member.freelancer_rate != null && member.freelancer_rate > 0) return member.freelancer_rate
  return null
}

/** What their pay basis says, for the hint under the picker. */
export function payBasisLabel(member: Pick<TeamMember, 'freelancer_rate' | 'payout_type' | 'engagement_type'>): string | null {
  const rate = member.freelancer_rate
  const per: Record<string, string> = {
    per_shoot: 'per shoot',
    per_day: 'per day',
    per_project: 'per project',
    custom: 'custom',
  }
  if (member.payout_type === 'salary') return 'Salaried — paid monthly, no per-shoot payout'
  if (rate != null && rate > 0) {
    const basis = member.payout_type ? per[member.payout_type] : undefined
    return `Freelancer · ₹${rate.toLocaleString('en-IN')}${basis ? ` ${basis}` : ''}`
  }
  if (member.engagement_type === 'freelancer') return 'Freelancer · no rate saved'
  return null
}

/** "10:00 am–2:00 pm", for a booking's window. */
export function hoursLabel(slot: Pick<TeamSlot, 'start_at' | 'end_at'>, timeZone?: string): string {
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) })
  return `${t(slot.start_at)}–${t(slot.end_at)}`
}

/**
 * Someone picked for a seat but not booked yet, with the payout typed for
 * them and, when their hours differ from the shoot's (a drone operator for
 * two of the five), their own start and hours.
 */
export interface SeatPick {
  id: string
  payout: string
  start?: string
  hours?: number
}

export interface BaseWindow {
  date: string
  time: string
  hours: number | null
}

/** The window one pick books: the shoot's, unless the pick says otherwise. */
export function windowFor(pick: { start?: string | undefined; hours?: number | undefined; id?: string; payout?: string }, base: BaseWindow): TimeWindow | null {
  const hours = pick.hours ?? base.hours
  if (hours == null) return null
  return windowOf(base.date, pick.start ?? base.time, hours)
}

/**
 * Picks read back from a saved draft: untyped JSON, so anything odd (an
 * `hours: "x"`, a missing payout) is dropped rather than booked.
 */
export function normalizePicks(raw: unknown): Record<string, SeatPick[]> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, SeatPick[]> = {}
  for (const [role, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    out[role] = list.flatMap((p): SeatPick[] => {
      if (!p || typeof p !== 'object' || typeof (p as { id?: unknown }).id !== 'string') return []
      const x = p as { id: string; payout?: unknown; start?: unknown; hours?: unknown }
      const pick: SeatPick = { id: x.id, payout: typeof x.payout === 'string' ? x.payout : '' }
      if (typeof x.start === 'string' && /^\d{2}:\d{2}/.test(x.start)) pick.start = x.start
      if (typeof x.hours === 'number' && Number.isFinite(x.hours) && x.hours > 0) pick.hours = x.hours
      return [pick]
    })
  }
  return out
}

/**
 * Seats still free on each requirement once the people already picked are
 * counted: what "+ Choose person" may still offer. Never below zero.
 */
export function seatsLeft(fill: readonly RequirementFill[], picks: Readonly<Record<string, readonly SeatPick[]>>): Map<string, number> {
  return new Map(fill.map((r) => [r.name, Math.max(0, r.open - (picks[r.name]?.length ?? 0))]))
}

/**
 * Who is already picked anywhere on this screen. One person holds one role
 * per sitting -- a second role at other hours is booked in another sitting.
 */
export function pickedIds(picks: Readonly<Record<string, readonly SeatPick[]>>): Set<string> {
  return new Set(Object.values(picks).flatMap((ps) => ps.map((p) => p.id)))
}

export interface RoleCount {
  name: string
  required: number
  booked: number
  picked: number
  /** Booked plus picked, never past what the role needs. */
  filled: number
}

/**
 * What each role shows while choosing: people picked on this screen count
 * the moment they are picked, not only once "Book" is pressed -- a counter
 * that stays at 0 after a pick reads as "that didn't work".
 */
export function withPicks(fill: readonly RequirementFill[], picks: Readonly<Record<string, readonly SeatPick[]>>): RoleCount[] {
  return fill.map((r) => {
    const booked = Math.min(r.assigned, r.required)
    const picked = Math.min(picks[r.name]?.length ?? 0, r.required - booked)
    return { name: r.name, required: r.required, booked, picked, filled: booked + picked }
  })
}

/** The whole shoot: seats needed, booked and picked-but-not-yet-booked. */
export function progressWithPicks(counts: readonly RoleCount[]) {
  const required = counts.reduce((n, r) => n + r.required, 0)
  const booked = counts.reduce((n, r) => n + r.booked, 0)
  const picked = counts.reduce((n, r) => n + r.picked, 0)
  return { required, booked, picked, filled: booked + picked }
}
