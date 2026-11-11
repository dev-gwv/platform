import type { PayoutMemory } from '@ipc/contracts'
import type { RateMember } from './assign'

/**
 * One-tap payouts for Assign team (owner, 11 Nov: "I should be able to just
 * click on it ... I should not be using any keyboard"). Pure, so it is tested.
 */

export interface PayoutChoice {
  amount: number
  /** Why this amount is offered, in the studio's words ("their wedding rate"). */
  why: string
}

export interface PayoutSection {
  title: string
  choices: PayoutChoice[]
}

/** Round amounts a studio pays crew, smallest first. */
export const ROUND_AMOUNTS = [1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 10000, 12000, 15000, 20000, 25000] as const

/** The nudge step for − / +. */
export const NUDGE = 500

/**
 * The sections the payout panel shows, each amount once across all of them:
 * the person's own rates, what they were paid before, what the studio usually
 * pays for this role, then round amounts.
 */
export function payoutChoices(
  member: Pick<RateMember, 'freelancer_rate' | 'rate_wedding_day' | 'rate_half_day'> & { name?: string | null },
  role: string,
  memory: PayoutMemory | undefined,
  userId: string,
): PayoutSection[] {
  const seen = new Set<number>()
  const take = (list: PayoutChoice[], max = 3) =>
    list.filter((c) => c.amount > 0 && Number.isFinite(c.amount) && !seen.has(c.amount) && (seen.add(c.amount), true)).slice(0, max)
  const first = (member.name ?? '').trim().split(/\s+/)[0] || 'them'

  const own = take([
    ...(member.freelancer_rate ? [{ amount: member.freelancer_rate, why: 'their day rate' }] : []),
    ...(member.rate_wedding_day ? [{ amount: member.rate_wedding_day, why: 'their wedding rate' }] : []),
    ...(member.rate_half_day ? [{ amount: member.rate_half_day, why: 'their half-day rate' }] : []),
  ])
  const before = take((memory?.people[userId] ?? []).map((amount) => ({ amount, why: `paid ${first} before` })))
  const usual = take((memory?.roles[role] ?? []).map((amount) => ({ amount, why: `usual for ${role}` })))
  const round = take(ROUND_AMOUNTS.map((amount) => ({ amount, why: '' })), ROUND_AMOUNTS.length)

  return [
    { title: 'Their rates', choices: own },
    { title: `Paid ${first} before`, choices: before },
    { title: `Usually for ${role}`, choices: usual },
    { title: 'Pick an amount', choices: round },
  ].filter((s) => s.choices.length > 0)
}

/** Move an amount by one nudge, never below zero. */
export function nudge(amount: number, by: 1 | -1): number {
  return Math.max(0, Math.round((amount + by * NUDGE) / NUDGE) * NUDGE)
}
