import type { PlanInstalment } from '@ipc/contracts'

/**
 * The payment plan the client agreed to, set against what has happened.
 *
 * The terms say "30% on booking, 30% before the wedding, 30% on the day, 10%
 * on delivery". This turns that into rupees and says, for each part, whether
 * the money is in, partly in, invoiced, due next, or still to come.
 *
 * Money received is counted against the parts in order -- the first rupee
 * pays the first instalment -- because that is how a studio talks about it
 * ("the advance is in, the second part is half paid"). Invoices are counted
 * the same way, by their value before GST, since the plan is on the package
 * price.
 */

export type PlanState = 'received' | 'part' | 'invoiced' | 'due' | 'upcoming'

export interface PlanRow {
  index: number
  label: string
  due_trigger: string | null
  amount: number
  received: number
  invoiced: number
  /** What is still to come in for this part. */
  remaining: number
  state: PlanState
}

const round = (n: number) => Math.round(n * 100) / 100

/** Rupees for each part. Percentages that add up to 100 always sum to the total exactly. */
export function instalmentAmounts(instalments: readonly PlanInstalment[], total: number): number[] {
  const amounts = instalments.map((i) => (i.mode === 'amount' ? i.value : round((total * i.value) / 100)))
  const allPercent = instalments.length > 0 && instalments.every((i) => i.mode === 'percent')
  const pct = instalments.reduce((n, i) => n + (i.mode === 'percent' ? i.value : 0), 0)
  if (allPercent && Math.abs(pct - 100) < 0.001 && amounts.length > 0) {
    const others = amounts.slice(0, -1).reduce((n, a) => n + a, 0)
    amounts[amounts.length - 1] = round(total - others)
  }
  return amounts
}

export function planStatus({
  instalments,
  total,
  received,
  invoiced,
}: {
  instalments: readonly PlanInstalment[]
  total: number
  /** Money that has actually come in on the project. */
  received: number
  /** Value (before GST) of the project's live invoices. */
  invoiced: number
}): PlanRow[] {
  const amounts = instalmentAmounts(instalments, total)
  let cash = Math.max(0, received)
  let billed = Math.max(0, invoiced)
  let nextMarked = false
  return instalments.map((inst, index) => {
    const amount = amounts[index] ?? 0
    const got = Math.min(cash, amount)
    cash = round(cash - got)
    const inv = Math.min(billed, amount)
    billed = round(billed - inv)
    const remaining = round(amount - got)
    let state: PlanState
    if (remaining <= 0.5) state = 'received'
    else if (got > 0) state = 'part'
    else if (inv >= amount - 0.5) state = 'invoiced'
    else if (!nextMarked) state = 'due'
    else state = 'upcoming'
    // Only one part is "next": the first one not fully in.
    if (state !== 'received' && !nextMarked) nextMarked = true
    return { index, label: inst.label, due_trigger: inst.due_trigger, amount, received: round(got), invoiced: round(inv), remaining, state }
  })
}

export const PLAN_STATE_LABEL: Record<PlanState, string> = {
  received: 'Received',
  part: 'Part received',
  invoiced: 'Invoiced',
  due: 'Due next',
  upcoming: 'Later',
}

/**
 * When a plan part falls due, worked out from the project's shoots: "Before
 * the wedding" is 7 days before the shoot named Wedding, "On the haldi" or
 * "Wedding day" is that day, "On booking" is the day the client agreed.
 * Anything it cannot place ("On delivery", a typed note) has no date. The
 * shoot is matched by its name appearing in the words, longest name first,
 * so "Pre-wedding" is not taken for "Wedding".
 */
export function planDueDate(
  trigger: string | null | undefined,
  ctx: { shoots: readonly { name: string; shoot_date: string | null }[]; agreedOn?: string | null | undefined },
): { date: string; why: string } | null {
  const t = (trigger ?? '').trim().toLowerCase()
  if (!t) return null
  if (/\b(booking|advance|confirm|sign)/.test(t)) return ctx.agreedOn ? { date: ctx.agreedOn.slice(0, 10), why: 'on booking' } : null
  const dated = ctx.shoots
    .filter((s): s is { name: string; shoot_date: string } => !!s.shoot_date && !!s.name.trim())
    .sort((a, b) => b.name.length - a.name.length)
  const shoot = dated.find((s) => new RegExp(`(^|[^a-z-])${s.name.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z-]|$)`).test(t))
  if (!shoot) return null
  if (/\bbefore\b/.test(t)) {
    const d = new Date(`${shoot.shoot_date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 7)
    return { date: d.toISOString().slice(0, 10), why: `7 days before ${shoot.name}` }
  }
  if (/\bafter\b/.test(t)) return null
  return { date: shoot.shoot_date, why: `on ${shoot.name}` }
}
