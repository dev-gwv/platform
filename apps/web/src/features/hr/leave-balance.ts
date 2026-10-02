import type { LeaveBalance, LeaveKind } from '@ipc/contracts'

const KIND: Record<string, string> = { casual: 'casual', sick: 'sick', paid: 'paid' }

/** 5, 5.5 -- never 5.0. */
export const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const dayWord = (n: number) => `${days(n)} ${n === 1 ? 'day' : 'days'}`

/** "9 of 12 casual left". */
export function balanceLine(b: Pick<LeaveBalance, 'kind' | 'allowance' | 'remaining'>): string {
  return `${days(Math.max(0, b.remaining))} of ${days(b.allowance)} ${KIND[b.kind] ?? b.kind} left`
}

/**
 * What an approver needs before saying yes: what is left of this kind and
 * whether this request goes past it. Null for a kind with no allowance
 * (unpaid, other, or one the studio has not set).
 */
export function approvalCheck(
  balances: readonly LeaveBalance[] | undefined,
  userId: string,
  kind: LeaveKind,
  requestDays: number | undefined,
): { text: string; over: number } | null {
  const b = balances?.find((x) => x.user_id === userId && x.kind === kind)
  if (!b || requestDays === undefined) return null
  const left = Math.max(0, b.remaining)
  const over = Math.max(0, requestDays - left)
  const has = left > 0 ? `${dayWord(left)} ${KIND[kind]} left` : `no ${KIND[kind]} leave left`
  return { text: over > 0 ? `Has ${has} · this is ${dayWord(requestDays)}, ${days(over)} over` : `Has ${has} · this is ${dayWord(requestDays)}`, over }
}
