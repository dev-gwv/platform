import { crewBucketOf, crewPersonTotals, lineBalance, type CrewPersonTotals } from '@ipc/domain'
import type { CrewOwed, CrewPayoutRow } from '@ipc/contracts'
import { amountsHidden, screenINR } from '@/shared/money/hide'

/** Team payouts' three views: what is owed now, what is promised, everything. */
type CrewView = 'owed' | 'upcoming' | 'all' | 'projects'
export const CREW_VIEWS: readonly { key: CrewView; label: string }[] = [
  { key: 'owed', label: 'Owed now' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'all', label: 'All' },
  // Every project's crew money on one line each (owner, 14 Nov: "how much
  // they have paid ... I am not able to find that").
  { key: 'projects', label: 'By project' },
]
export function crewViewOf(v: string | null | undefined): CrewView {
  return v === 'upcoming' || v === 'all' || v === 'projects' ? v : 'owed'
}

/** Worked out on the server for the page (and here for the CSV): see crew-owed.ts in @ipc/domain. */
export { crewByProject, crewRowsFor, type ProjectCrewMoney } from '@ipc/domain'

/**
 * One row's money in words: "₹6,000 left of ₹10,000", "₹3,000 paid in advance", "Paid".
 * Masked while amounts are hidden; pass `hidden = false` for a CSV export.
 */
export function crewRowLine(r: Pick<CrewPayoutRow, 'amount' | 'paid' | 'shoot_date' | 'stands'>, today: string, hidden: boolean = amountsHidden()): string {
  const money = (n: number) => screenINR(n, hidden)
  if (!r.stands) return `${money(r.paid)} paid · booking released`
  if (r.amount <= 0) return 'No payout set'
  const left = lineBalance(r)
  const upcoming = crewBucketOf(r.shoot_date, today) === 'upcoming'
  if (left <= 0.001) return upcoming ? `${money(r.paid)} paid in advance` : 'Paid'
  if (r.paid > 0) {
    return upcoming
      ? `${money(r.paid)} paid in advance · ${money(left)} after the shoot`
      : `${money(left)} left of ${money(r.amount)}`
  }
  return upcoming ? `${money(r.amount)} after the shoot` : `${money(r.amount)} owed`
}

/**
 * " · amount may change" while a booked payout is not final and still has
 * money to go. Once it is paid in full the amount is what was paid, so the
 * line says nothing more.
 */
export function crewRowNote(r: Pick<CrewPayoutRow, 'amount' | 'paid' | 'stands' | 'cost_status'>): string {
  if (!r.stands || r.amount <= 0 || r.cost_status === 'final' || lineBalance(r) <= 0.001) return ''
  return ' · amount may change'
}

/**
 * A person's header on Team payouts: "₹6,000 owed · ₹12,000 after the
 * shoots · 3 shoots". Money for a shoot not yet done is never "owed" or
 * "left" -- crew money is owed once the shoot day has passed.
 */
export function crewPersonLine(
  list: readonly Pick<CrewPayoutRow, 'user_id' | 'user_name' | 'amount' | 'paid' | 'shoot_date'>[],
  today: string,
  money: (n: number) => string,
): string {
  const t = crewPersonTotals(list, today)
  const sum = t.reduce(
    (a, p) => ({ owed: a.owed + p.owed, ahead: a.ahead + p.ahead, ahead_shoots: a.ahead_shoots + p.ahead_shoots, shoots: a.shoots + p.shoots }),
    { owed: 0, ahead: 0, ahead_shoots: 0, shoots: 0 },
  )
  return crewPersonWords(sum, money)
}

/** The same header from a person's totals, as the server sends them with a page. */
export function crewPersonWords(
  t: Pick<CrewPersonTotals, 'owed' | 'ahead' | 'ahead_shoots' | 'shoots'>,
  money: (n: number) => string,
): string {
  const parts: string[] = []
  if (t.owed > 0.001) parts.push(`${money(t.owed)} owed`)
  if (t.ahead > 0.001) parts.push(`${money(t.ahead)} after the ${t.ahead_shoots === 1 ? 'shoot' : 'shoots'}`)
  if (parts.length === 0) parts.push('All paid')
  parts.push(`${t.shoots} ${t.shoots === 1 ? 'shoot' : 'shoots'}`)
  return parts.join(' · ')
}

/** The dashboard's "Who you owe" sentence. */
export function whoYouOweLine(o: Pick<CrewOwed, 'owed_now' | 'people'>): string {
  if (o.owed_now <= 0) return 'All crew paid for shoots already done'
  const n = o.people.length
  return `${screenINR(o.owed_now)} to ${n} ${n === 1 ? 'person' : 'people'} for shoots already done`
}

/** My payouts' headline, in the person's words. */
export function myPayoutsLine(m: { owed_now: number; upcoming: number; paid: number; paid_ahead: number }): string {
  const parts: string[] = []
  if (m.owed_now > 0) parts.push(`${screenINR(m.owed_now)} due to you for shoots already done`)
  if (m.upcoming > 0) parts.push(`${screenINR(m.upcoming)} for shoots coming up`)
  if (parts.length === 0) parts.push('You have been paid for every shoot so far')
  if (m.paid > 0) parts.push(`${screenINR(m.paid)} paid${m.paid_ahead > 0 ? `, ${screenINR(m.paid_ahead)} of it in advance` : ''}`)
  return `${parts.join(' · ')}.`
}
