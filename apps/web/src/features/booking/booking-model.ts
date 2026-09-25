import type { ShootListItem, TeamMember, TeamSlot } from '@ipc/contracts'

/**
 * Team Booking's arithmetic, kept out of the components so it can be argued
 * with in tests: who fills which role on a shoot, how staffed the shoot is,
 * what each person's month looks like, and what needs fixing.
 */

/** Role names match the way a person types them: case and spacing do not count. */
export const sameRole = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === (b ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

const live = (s: TeamSlot) => s.status === 'booked'
const byStart = (a: TeamSlot, b: TeamSlot) => a.start_at.localeCompare(b.start_at) || (a.user_name ?? '').localeCompare(b.user_name ?? '')

export type Fill = 'full' | 'partial' | 'empty'

export interface RoleCard {
  name: string
  quantity: number
  /** Everyone booked against this role, in the order they start. */
  people: TeamSlot[]
  /** How many seats are still open (never below zero). */
  open: number
  fill: Fill
}

/**
 * One card per role the shoot asked for, and the bookings on the shoot whose
 * role matches none of them -- a role renamed after booking, or someone added
 * for a job that was never planned -- so nobody booked is hidden.
 */
export function roleCards(shoot: Pick<ShootListItem, 'id' | 'requirements'>, slots: readonly TeamSlot[]): { cards: RoleCard[]; extra: TeamSlot[] } {
  const mine = slots.filter((s) => s.shoot_id === shoot.id && live(s)).sort(byStart)
  const used = new Set<string>()
  const cards = shoot.requirements.map((r) => {
    const quantity = Math.max(1, r.quantity)
    const people = mine.filter((s) => sameRole(s.service_name, r.name))
    for (const p of people) used.add(p.id)
    const filled = Math.min(people.length, quantity)
    return {
      name: r.name,
      quantity,
      people,
      open: quantity - filled,
      fill: (filled === 0 ? 'empty' : filled >= quantity ? 'full' : 'partial') as Fill,
    }
  })
  return { cards, extra: mine.filter((s) => !used.has(s.id)) }
}

export type Staffing = 'none' | 'empty' | 'partial' | 'full'

/** Seats needed and filled (capped per role), and what that adds up to. */
export function staffing(shoot: Pick<ShootListItem, 'id' | 'requirements'>, slots: readonly TeamSlot[]) {
  const { cards } = roleCards(shoot, slots)
  const needed = cards.reduce((n, c) => n + c.quantity, 0)
  const filled = cards.reduce((n, c) => n + (c.quantity - c.open), 0)
  const state: Staffing = needed === 0 ? 'none' : filled === 0 ? 'empty' : filled >= needed ? 'full' : 'partial'
  return { needed, filled, state }
}

// ── dates ──────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
/** The calendar day an instant falls on, where the viewer is. */
export const localDay = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const todayLocal = () => localDay(new Date().toISOString())

/** "2026-09" -> every day of that month, as YYYY-MM-DD. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(y, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`)
}

export const monthOf = (day: string) => day.slice(0, 7)

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** The days a booking covers: a shoot that runs past midnight is on both. */
export function daysOf(slot: Pick<TeamSlot, 'start_at' | 'end_at'>): string[] {
  const out: string[] = []
  const start = new Date(slot.start_at)
  // A booking that ends exactly at midnight does not spill into the next day.
  const end = new Date(new Date(slot.end_at).getTime() - 1)
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  while (cur <= end && out.length < 62) {
    out.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`)
    cur.setDate(cur.getDate() + 1)
  }
  return out.length ? out : [localDay(slot.start_at)]
}

export const hoursOf = (s: Pick<TeamSlot, 'start_at' | 'end_at'>) =>
  Math.max(0, (Date.parse(s.end_at) - Date.parse(s.start_at)) / 3_600_000)

// ── the month, person by person ────────────────────────────────────
export interface PersonMonth {
  member: Pick<TeamMember, 'user_id' | 'name' | 'role_names'>
  /** Bookings by day (booked and released; cancelled ones are gone). */
  byDay: Map<string, TeamSlot[]>
  shoots: number
  days: number
  hours: number
}

/**
 * Every active member's month: which days they are out, on what, and how
 * much that adds up to. Busiest first; the free ones last, by name.
 */
export function monthGrid(members: readonly PersonMonth['member'][], slots: readonly TeamSlot[], month: string): PersonMonth[] {
  const days = new Set(monthDays(month))
  const rows = members.map((member) => {
    const byDay = new Map<string, TeamSlot[]>()
    const shoots = new Set<string>()
    let hours = 0
    for (const s of slots) {
      if (s.user_id !== member.user_id || s.status === 'cancelled') continue
      const inMonth = daysOf(s).filter((d) => days.has(d))
      if (!inMonth.length) continue
      for (const d of inMonth) byDay.set(d, [...(byDay.get(d) ?? []), s].sort(byStart))
      if (s.status === 'booked') {
        shoots.add(s.shoot_id ?? s.id)
        hours += hoursOf(s)
      }
    }
    const bookedDays = [...byDay.values()].filter((list) => list.some(live)).length
    return { member, byDay, shoots: shoots.size, days: bookedDays, hours: Math.round(hours * 10) / 10 }
  })
  return rows.sort((a, b) => b.days - a.days || b.hours - a.hours || a.member.name.localeCompare(b.member.name))
}

// ── what needs fixing ──────────────────────────────────────────────
export type ConflictSeverity = 'critical' | 'warning' | 'info'
export type ConflictType = 'double_booking' | 'invalid_time_range' | 'missing_service' | 'past_active'

export interface ConflictItem {
  key: string
  type: ConflictType
  severity: ConflictSeverity
  slot: TeamSlot
  other?: TeamSlot
  message: string
}

export const CONFLICT_LABEL: Record<ConflictType, string> = {
  double_booking: 'Double booking',
  invalid_time_range: 'Ends before it starts',
  missing_service: 'No role',
  past_active: 'Still open after the day',
}

const overlap = (a: TeamSlot, b: TeamSlot) => a.start_at < b.end_at && b.start_at < a.end_at

/**
 * Every booked slot that needs a second look: the same person twice at once,
 * a time range that ends before it starts, a booking with no role, or one
 * still open after its shoot day -- unless the shoot itself is done or called
 * off, when there is nothing left to chase. Time held off a shoot (leave,
 * another job) is not a problem: that is what Block time is for.
 */
export function conflictItems(slots: readonly TeamSlot[], now = Date.now()): ConflictItem[] {
  const booked = slots.filter(live).sort(byStart)
  const items: ConflictItem[] = []
  for (let i = 0; i < booked.length; i++) {
    for (let j = i + 1; j < booked.length; j++) {
      const a = booked[i]!
      const b = booked[j]!
      if (b.start_at >= a.end_at && a.user_id !== b.user_id) continue
      if (a.user_id === b.user_id && overlap(a, b)) {
        items.push({
          key: `double-${a.id}-${b.id}`,
          type: 'double_booking',
          severity: 'critical',
          slot: a,
          other: b,
          message: `${a.user_name ?? 'Someone'} is booked twice at the same time`,
        })
      }
    }
  }
  for (const s of booked) {
    if (Date.parse(s.end_at) <= Date.parse(s.start_at)) {
      items.push({ key: `range-${s.id}`, type: 'invalid_time_range', severity: 'critical', slot: s, message: 'Ends before (or when) it starts' })
    }
    if (!(s.service_name ?? '').trim()) {
      items.push({ key: `role-${s.id}`, type: 'missing_service', severity: 'warning', slot: s, message: 'Booked without a role' })
    }
    const settled = s.shoot_status === 'completed' || s.shoot_status === 'cancelled'
    if (Date.parse(s.end_at) < now && s.shoot_id && !settled) {
      items.push({ key: `past-${s.id}`, type: 'past_active', severity: 'info', slot: s, message: 'Still open after the shoot day. Mark the shoot done, or release the booking.' })
    }
  }
  const rank: Record<ConflictSeverity, number> = { critical: 0, warning: 1, info: 2 }
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.slot.start_at.localeCompare(b.slot.start_at))
}

// ── the four figures ───────────────────────────────────────────────
export function figures(shoots: readonly Pick<ShootListItem, 'id' | 'requirements'>[], slots: readonly TeamSlot[], conflicts: number) {
  let needed = 0
  let filled = 0
  let short = 0
  for (const s of shoots) {
    const st = staffing(s, slots)
    needed += st.needed
    filled += st.filled
    if (st.state === 'empty' || st.state === 'partial') short += 1
  }
  const shootIds = new Set(shoots.map((s) => s.id))
  const people = new Set(slots.filter((s) => live(s) && s.shoot_id && shootIds.has(s.shoot_id)).map((s) => s.user_id))
  return { shoots: shoots.length, needed, filled, toFill: needed - filled, shortShoots: short, people: people.size, conflicts }
}

// ── outside the app ────────────────────────────────────────────────
/** The WhatsApp message a manager sends someone they just booked. */
export function bookingMessage(slot: TeamSlot): string {
  const when = new Date(slot.start_at).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
  const until = new Date(slot.end_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  const first = (slot.user_name ?? '').split(' ')[0] || 'there'
  return [
    `Hi ${first}, you are booked for ${slot.shoot_name ?? 'a shoot'}${slot.project_name ? ` (${slot.project_name})` : ''}.`,
    `When: ${when} – ${until}`,
    slot.service_name ? `Role: ${slot.service_name}` : null,
    slot.location ? `Where: ${slot.location}` : null,
    slot.map_link ? `Map: ${slot.map_link}` : null,
    'Please be there on time, and tell us early if anything changes.',
  ]
    .filter(Boolean)
    .join('\n')
}
