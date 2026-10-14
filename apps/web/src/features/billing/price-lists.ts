import type { Plan } from '@ipc/contracts'

/**
 * Two price lists of the same three plans (owner, 14 Oct): the regular one
 * that everyone pays, and right below it the IPC Diamond members' -- Diamond
 * Starter, Diamond Pro, Diamond Studio Max -- the same features at about half
 * the price. These are the sums the two sections need to say it plainly.
 */

/** Every plan carries 18% GST on top, as create_payment_order charges it. */
export const withGst = (price: number) => Math.round(price * 1.18)

/** What the plan costs a month: the price itself when monthly, else its monthly figure. */
export const monthlyOf = (p: Pick<Plan, 'price' | 'billing_interval' | 'monthly_equivalent'>) =>
  p.billing_interval === 'monthly' ? p.price : (p.monthly_equivalent ?? Math.round(p.price / 12))

/** The same plan in the other list: the same tier, paid the same way. */
export function twinOf(p: Pick<Plan, 'tier' | 'billing_interval'>, list: Plan[] | undefined): Plan | undefined {
  return list?.find((x) => x.tier === p.tier && x.billing_interval === p.billing_interval)
}

/** What a member keeps against the regular price, in rupees for one billing period; 0 when nothing. */
export function savingOf(member: Pick<Plan, 'price'>, regular: Pick<Plan, 'price'> | undefined): number {
  return regular ? Math.max(0, regular.price - member.price) : 0
}

/** "Save ₹18,000 a year" / "Save ₹2,000 a month", or null when the member price is not lower. */
export function savingWords(
  member: Pick<Plan, 'price' | 'billing_interval'>,
  regular: Pick<Plan, 'price'> | undefined,
  inr: (n: number) => string,
): string | null {
  const s = savingOf(member, regular)
  if (s <= 0) return null
  return `Save ${inr(s)} ${member.billing_interval === 'monthly' ? 'a month' : 'a year'}`
}

/** "about half": the share off the regular price, rounded, for "50% off". */
export function percentOff(member: Pick<Plan, 'price'>, regular: Pick<Plan, 'price'> | undefined): number {
  if (!regular || regular.price <= 0) return 0
  return Math.max(0, Math.round((1 - member.price / regular.price) * 100))
}

/** The most a member saves on any one plan paid this way -- the headline of the Diamond section. */
export function bestSaving(member: Plan[], regular: Plan[]): number {
  return member.reduce((best, p) => Math.max(best, savingOf(p, twinOf(p, regular))), 0)
}

/**
 * Which list comes first. A studio that has not checked its number reads the
 * regular price on top and the members' below; a verified IPC Diamond member
 * reads their own price first and the regular one beneath, for comparison.
 */
export function sectionOrder(memberFirst: boolean): readonly ['regular', 'member'] | readonly ['member', 'regular'] {
  return memberFirst ? (['member', 'regular'] as const) : (['regular', 'member'] as const)
}
