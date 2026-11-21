import { crewState, type BookedSlot, type CrewRequirement } from './slots'

/**
 * The numbers behind the studio Home's tiles, worked out on the server
 * (`GET /dashboard/summary`) so Home asks one light question instead of
 * downloading the whole call queue, the week's shoots and every booking.
 * The rules are the tiles' own (apps/web `features/dashboard/tiles.ts`);
 * `home-tiles.test.ts` there checks the two agree.
 */

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The last day of the shoots tile's week: today and six days on. */
export const homeWeekEnd = (today: string) => addDays(today, 6)

export interface WeekShoot {
  id: string
  shoot_date: string | null
  status: string
  requirements: readonly CrewRequirement[]
}

/**
 * Shoots from today to six days on (not cancelled), and how many of them still
 * need people: some roles asked for and not every seat booked.
 */
export function weekShootCounts(
  shoots: readonly WeekShoot[],
  slots: readonly BookedSlot[],
  today: string,
): { count: number; short: number } {
  const end = homeWeekEnd(today)
  const booked = slots.filter((s) => s.status === 'booked')
  const week = shoots.filter((s) => s.status !== 'cancelled' && !!s.shoot_date && s.shoot_date >= today && s.shoot_date <= end)
  const short = week.filter((s) => {
    const state = crewState(s.id, s.requirements, booked)
    return state === 'unassigned' || state === 'partial'
  }).length
  return { count: week.length, short }
}

/** Who is owed a call today, and how many of them were never rung. */
export function callCounts(queue: readonly { last_contacted_at: string | null }[]): { to_call: number; not_contacted: number } {
  return { to_call: queue.length, not_contacted: queue.filter((l) => !l.last_contacted_at).length }
}
