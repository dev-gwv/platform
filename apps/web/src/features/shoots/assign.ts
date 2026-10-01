import type { LeaveRequest, ShootListItem, TeamMember, TeamSlot } from '@ipc/contracts'

/**
 * The rules behind assigning crew to a shoot, kept out of the dialogs so they
 * can be tested on their own: how full each requirement is, who is free at a
 * given time, who fits a role, and what to pre-fill as their payout.
 *
 * A booking is a window (start → end). A person is busy when any of their
 * live bookings -- on this shoot or any other -- overlaps it. Travel between
 * two bookings is the planner's judgement: the screens show the hours.
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

/** Do two windows overlap? Back to back is not a clash. */
export function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end)
}

/**
 * The live booking that makes this person unavailable for the window, if any:
 * a true overlap only. How long they need to get from one place to the next
 * is the planner's call, not a setting (the owner found a "gap" control
 * confusing), so the screen shows the other booking's hours and lets them
 * judge. `ignoreSlotId` leaves out the booking being changed.
 */
export function clashFor(
  userId: string,
  window: TimeWindow,
  slots: readonly TeamSlot[],
  { ignoreSlotId }: { ignoreSlotId?: string | undefined } = {},
): TeamSlot | null {
  return (
    slots.find(
      (s) => s.user_id === userId && isLive(s) && s.id !== ignoreSlotId && overlaps(window, { start: s.start_at, end: s.end_at }),
    ) ?? null
  )
}

/** The calendar day an instant falls on, where the viewer is. */
export const localDay = (iso: string) => localDate(new Date(iso))

/** Midnight to midnight of a local day, as instants. */
function dayBounds(day: string): { from: number; to: number } {
  const from = new Date(`${day}T00:00:00`).getTime()
  const next = new Date(`${day}T00:00:00`)
  next.setDate(next.getDate() + 1)
  return { from, to: next.getTime() }
}

/**
 * Someone's live bookings that touch a local day, on any project, earliest
 * first. A booking that runs past midnight belongs to both days.
 */
export function bookingsOn(
  userId: string,
  day: string,
  slots: readonly TeamSlot[],
  { ignoreSlotId }: { ignoreSlotId?: string | undefined } = {},
): TeamSlot[] {
  const { from, to } = dayBounds(day)
  return slots
    .filter((s) => s.user_id === userId && isLive(s) && s.id !== ignoreSlotId)
    .filter((s) => Date.parse(s.start_at) < to && Date.parse(s.end_at) > from)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
}

/** Hours booked on a local day, counting only the part of each booking on it. */
export function bookedHours(bookings: readonly Pick<TeamSlot, 'start_at' | 'end_at'>[], day: string): number {
  const { from, to } = dayBounds(day)
  const ms = bookings.reduce((n, s) => n + Math.max(0, Math.min(Date.parse(s.end_at), to) - Math.max(Date.parse(s.start_at), from)), 0)
  return Math.round((ms / 3_600_000) * 2) / 2
}

export interface FreeGap {
  /** Null: from the start of the day. */
  from: string | null
  /** Null: to the end of the day. */
  to: string | null
}

/** The stretches of a local day with nothing booked, between the bookings given. */
export function freeGaps(bookings: readonly Pick<TeamSlot, 'start_at' | 'end_at'>[], day: string): FreeGap[] {
  const { from, to } = dayBounds(day)
  const spans = bookings
    .map((s) => ({ s: Math.max(Date.parse(s.start_at), from), e: Math.min(Date.parse(s.end_at), to) }))
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s)
  if (spans.length === 0) return [{ from: null, to: null }]
  const gaps: FreeGap[] = []
  let cursor = from
  for (const sp of spans) {
    if (sp.s > cursor) gaps.push({ from: cursor === from ? null : new Date(cursor).toISOString(), to: new Date(sp.s).toISOString() })
    cursor = Math.max(cursor, sp.e)
  }
  if (cursor < to) gaps.push({ from: new Date(cursor).toISOString(), to: null })
  return gaps
}

/** "Free before 3 PM, 6–7 PM, after 9 PM" -- or "Free all day", or "No free time that day". */
export function freeText(gaps: readonly FreeGap[], timeZone?: string): string {
  if (gaps.length === 0) return 'No free time that day'
  if (gaps.length === 1 && gaps[0]!.from === null && gaps[0]!.to === null) return 'Free all day'
  const t = (iso: string) => timeLabel(iso, timeZone)
  const parts = gaps.map((g) =>
    g.from === null ? `before ${t(g.to!)}` : g.to === null ? `after ${t(g.from)}` : clockRange(g.from, g.to, timeZone),
  )
  return `Free ${parts.join(', ')}`
}

/** Approved leave on a day: a whole day, half a day, or none. */
export function leaveOn(
  userId: string,
  day: string,
  leaves: readonly Pick<LeaveRequest, 'user_id' | 'start_date' | 'end_date' | 'half_day' | 'status'>[],
): 'full' | 'half' | null {
  const hit = leaves.find((l) => l.user_id === userId && l.status === 'approved' && l.start_date <= day && l.end_date >= day)
  if (!hit) return null
  return hit.half_day ? 'half' : 'full'
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
  | { state: 'busy'; slot: TeamSlot; onThisShoot: boolean }

export interface Candidate {
  member: TeamMember
  match: boolean
  availability: Availability
  /** Approved leave on the day being booked. Still pickable: the planner decides. */
  leave: 'full' | 'half' | null
}

/** Whether a pick with this availability can go ahead (the database refuses an overlap). */
export const canPick = (a: Availability) => a.state === 'free'

/**
 * Everyone, sorted for picking someone for `requirement` at `window`: free
 * people whose job role fits first, then other free people, then free people
 * on leave that day, then those who cannot take it -- with the reason,
 * rather than silently leaving them out, so "why is Rahul not in the list?"
 * answers itself.
 */
export function candidatesFor({
  members,
  requirement,
  window,
  shootId,
  slots,
  ignoreSlotId,
  leaves = [],
}: {
  members: readonly TeamMember[]
  requirement: string
  window: TimeWindow | null
  shootId: string
  slots: readonly TeamSlot[]
  ignoreSlotId?: string | undefined
  leaves?: readonly LeaveRequest[]
}): Candidate[] {
  const onRole = new Set(
    slots
      .filter((s) => isLive(s) && s.shoot_id === shootId && key(s.service_name) === key(requirement) && s.id !== ignoreSlotId)
      .map((s) => s.user_id),
  )
  const day = window ? localDay(window.start) : null
  const rank = (c: Candidate) => {
    if (c.availability.state !== 'free') return 4
    return (c.leave ? 2 : 0) + (c.match ? 0 : 1)
  }
  return members
    .map((member): Candidate => {
      const match = roleMatches(member, requirement)
      const leave = day ? leaveOn(member.user_id, day, leaves) : null
      if (onRole.has(member.user_id)) return { member, match, leave, availability: { state: 'on_role' } }
      const hit = window ? clashFor(member.user_id, window, slots, { ignoreSlotId }) : null
      if (!hit) return { member, match, leave, availability: { state: 'free' } }
      return { member, match, leave, availability: { state: 'busy', slot: hit, onThisShoot: hit.shoot_id === shootId } }
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

/** "3–6 PM", or "11 AM–3 PM" when the halves of the day differ. */
export function clockRange(start: string, end: string, timeZone?: string): string {
  const a = timeLabel(start, timeZone)
  const b = timeLabel(end, timeZone)
  const half = (s: string) => s.slice(-2)
  return `${half(a) === half(b) ? a.slice(0, -3) : a}–${b}`
}

/** "4–9 PM · 5 h". */
export function rangeLabel(window: TimeWindow, timeZone?: string): string {
  const hours = Math.round(((Date.parse(window.end) - Date.parse(window.start)) / 3_600_000) * 2) / 2
  const h = Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
  return `${clockRange(window.start, window.end, timeZone)} · ${h} h`
}

/** What a booking is for, in the fewest words: the shoot, else "blocked". */
export function slotName(slot: Pick<TeamSlot, 'shoot_name' | 'shoot_id' | 'service_name'>): string {
  if (slot.shoot_name) return slot.shoot_name
  if (!slot.shoot_id) return slot.service_name ?? 'blocked time'
  return slot.service_name ?? 'another shoot'
}

/** "Engagement (Sharma Wedding)", "Engagement", or "Blocked time". */
export function slotWhat(slot: Pick<TeamSlot, 'shoot_name' | 'shoot_id' | 'service_name' | 'project_name'>): string {
  if (!slot.shoot_id) return slot.service_name ? `Blocked · ${slot.service_name}` : 'Blocked time'
  const what = slot.shoot_name ?? slot.service_name ?? 'Another shoot'
  return slot.project_name ? `${what} (${slot.project_name})` : what
}

/** "7–9 PM · Sangeet (Mehta Wedding)". */
export const bookingText = (s: TeamSlot, timeZone?: string) => `${clockRange(s.start_at, s.end_at, timeZone)} · ${slotWhat(s)}`

/** "7–9 PM · Sangeet (Mehta Wedding), 10 PM–1 AM · Reception +1 more", or null when there is nothing else. */
function bookingList(others: readonly TeamSlot[], timeZone?: string): string | null {
  if (others.length === 0) return null
  const shown = others.slice(0, 2).map((s) => bookingText(s, timeZone)).join(', ')
  return others.length > 2 ? `${shown} +${others.length - 2} more` : shown
}

/** Under a booked person: "Also booked 7–9 PM · Sangeet (Mehta Wedding)", or null. */
export function alsoBookedText(others: readonly TeamSlot[], timeZone?: string): string | null {
  const list = bookingList(others, timeZone)
  return list ? `Also booked ${list}` : null
}

export interface AvailabilityLine {
  tone: 'green' | 'amber' | 'muted'
  text: string
}

/**
 * One line under a name, in the studio's words: whether they can take this
 * time, and what else they have that day on any project -- so the planner
 * sees "booked at the Sharma wedding 3–6 PM" and judges the travel.
 * `others` are their other bookings that day (`bookingsOn`).
 */
export function availabilityLine(
  c: Pick<Candidate, 'availability'> & { leave?: 'full' | 'half' | null },
  others: readonly TeamSlot[],
  timeZone?: string,
): AvailabilityLine {
  const a = c.availability
  if (a.state === 'on_role') return { tone: 'muted', text: 'Already on this role' }
  if (a.state === 'busy') {
    if (a.onThisShoot) return { tone: 'muted', text: `Already on this shoot as ${a.slot.service_name ?? 'another role'}` }
    return { tone: 'muted', text: `Busy ${bookingText(a.slot, timeZone)}` }
  }
  if (c.leave === 'full') return { tone: 'amber', text: 'On leave that day' }
  if (c.leave === 'half') return { tone: 'amber', text: 'Half-day leave that day' }
  const list = bookingList(others, timeZone)
  if (!list) return { tone: 'green', text: 'Free all day' }
  return { tone: 'green', text: `Free at this time · also booked ${list}` }
}

/**
 * Someone's whole day, for the card that opens when you hover over (or tap)
 * their name anywhere a person is booked: what they are on and when, how
 * many hours that is, and when they are free.
 */
export function personDay(
  userId: string,
  day: string,
  slots: readonly TeamSlot[],
  timeZone?: string,
): { bookings: TeamSlot[]; hours: number; free: string } {
  const bookings = bookingsOn(userId, day, slots)
  return { bookings, hours: bookedHours(bookings, day), free: freeText(freeGaps(bookings, day), timeZone) }
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
