/**
 * Team-slot overlap. Two bookings for the same member conflict when their time
 * ranges overlap; back-to-back (end == start) is allowed. Pure — mirrors the DB
 * guard and powers the client-side conflict preview before a booking is sent.
 */
export interface TimeSlot {
  start_at: string | Date
  end_at: string | Date
}

const ms = (v: string | Date) => (v instanceof Date ? v.getTime() : new Date(v).getTime())

/** Half-open overlap: [aStart,aEnd) intersects [bStart,bEnd). */
export function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  return ms(a.start_at) < ms(b.end_at) && ms(b.start_at) < ms(a.end_at)
}

/** Every existing slot that clashes with the candidate. */
export function findConflicts<T extends TimeSlot>(candidate: TimeSlot, existing: readonly T[]): T[] {
  return existing.filter((e) => overlaps(candidate, e))
}

/**
 * How much of a shoot's crew is actually booked.
 *
 * The rule is per requirement, not per shoot: a day needing two photographers
 * and one editor is not covered by three photographers. Each requirement is
 * filled only by booked slots carrying the same service name, and counting
 * stops at the quantity asked for — a third photographer does not make up for
 * the missing editor.
 *
 * Extracted here because two screens need the same answer. Team Booking counts
 * unassigned shoots; the shoots list filters by the same state. Two copies of
 * this arithmetic would eventually disagree, and then the tile would say three
 * while the filter showed two.
 */
export interface CrewRequirement {
  name: string
  quantity: number
}

export interface BookedSlot {
  shoot_id: string | null
  service_name: string | null
  status: string
}

/** Whitespace and case are how the same role gets typed two ways. */
const sameRole = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/** Roles asked for on this shoot. */
function rolesNeeded(requirements: readonly CrewRequirement[]): number {
  return requirements.reduce((n, r) => n + r.quantity, 0)
}

/** Roles filled, capped per requirement. Only `booked` slots count. */
export function rolesFilled(
  shootId: string,
  requirements: readonly CrewRequirement[],
  slots: readonly BookedSlot[],
): number {
  return requirements.reduce((n, r) => {
    const have = slots.filter(
      (s) => s.status === 'booked' && s.shoot_id === shootId && sameRole(s.service_name, r.name),
    ).length
    return n + Math.min(r.quantity, have)
  }, 0)
}

/**
 * `unplanned` is its own answer, not a kind of unassigned.
 *
 * A shoot with no requirements has nobody missing — nothing was asked for yet.
 * Folding it into "unassigned" would put every half-created shoot in the list
 * of days that need crew, which is the list somebody works through.
 */
export type CrewState = 'unplanned' | 'unassigned' | 'partial' | 'full'

export function crewState(
  shootId: string,
  requirements: readonly CrewRequirement[],
  slots: readonly BookedSlot[],
): CrewState {
  const needed = rolesNeeded(requirements)
  if (needed === 0) return 'unplanned'
  const filled = rolesFilled(shootId, requirements, slots)
  if (filled === 0) return 'unassigned'
  return filled >= needed ? 'full' : 'partial'
}
