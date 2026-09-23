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
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * Where a new booking on this shoot starts by default: the shoot's own hours
 * when it has them, else 9am for four hours on its day.
 */
export function defaultWindowFields(
  shoot: Pick<ShootListItem, 'shoot_date' | 'start_at' | 'end_at'>,
  today: string = localDate(new Date()),
): { date: string; time: string; hours: number } {
  if (shoot.start_at) {
    const s = new Date(shoot.start_at)
    const e = shoot.end_at ? new Date(shoot.end_at) : null
    const hours = e && e > s ? Math.round(((e.getTime() - s.getTime()) / 3_600_000) * 2) / 2 : 4
    return { date: localDate(s), time: localTime(s), hours }
  }
  return { date: shoot.shoot_date ?? today, time: '09:00', hours: 4 }
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
 * The booking that makes this person unavailable for the window, if any.
 * `ignoreSlotId` leaves out the booking being changed, so moving a person's
 * own slot is never reported as clashing with itself.
 */
export function clashFor(
  userId: string,
  window: TimeWindow,
  slots: readonly TeamSlot[],
  { bufferMin = 0, ignoreSlotId }: { bufferMin?: number; ignoreSlotId?: string | undefined } = {},
): TeamSlot | null {
  return (
    slots.find(
      (s) =>
        s.user_id === userId &&
        isLive(s) &&
        s.id !== ignoreSlotId &&
        overlaps(window, { start: s.start_at, end: s.end_at }, bufferMin),
    ) ?? null
  )
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
  | { state: 'busy'; slot: TeamSlot }

export interface Candidate {
  member: TeamMember
  match: boolean
  availability: Availability
}

/**
 * Everyone, sorted for picking someone for `requirement` at `window`: free
 * people whose job role fits first, then other free people, then those who
 * cannot take it -- with the reason, rather than silently leaving them out,
 * so "why is Rahul not in the list?" answers itself.
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
  const rank = (c: Candidate) => (c.availability.state === 'free' ? (c.match ? 0 : 1) : 2)
  return members
    .map((member): Candidate => {
      const match = roleMatches(member, requirement)
      if (onRole.has(member.user_id)) return { member, match, availability: { state: 'on_role' } }
      const hit = window ? clashFor(member.user_id, window, slots, { bufferMin, ignoreSlotId }) : null
      return { member, match, availability: hit ? { state: 'busy', slot: hit } : { state: 'free' } }
    })
    .sort((a, b) => rank(a) - rank(b) || a.member.name.localeCompare(b.member.name))
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
export function hoursLabel(slot: Pick<TeamSlot, 'start_at' | 'end_at'>): string {
  const t = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  return `${t(slot.start_at)}–${t(slot.end_at)}`
}
