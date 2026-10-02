/**
 * A project's payment plan in rupees and dates, and what is still to come in
 * placed on a calendar -- shared by the Billing tab and Payments received.
 */

export interface PlanPart {
  label: string
  mode: 'percent' | 'amount'
  value: number
  due_trigger: string | null
}

const round = (n: number) => Math.round(n * 100) / 100

/** Rupees for each part. Percentages that add up to 100 always sum to the total exactly. */
export function instalmentAmounts(parts: readonly PlanPart[], total: number): number[] {
  const amounts = parts.map((i) => (i.mode === 'amount' ? i.value : round((total * i.value) / 100)))
  const allPercent = parts.length > 0 && parts.every((i) => i.mode === 'percent')
  const pct = parts.reduce((n, i) => n + (i.mode === 'percent' ? i.value : 0), 0)
  if (allPercent && Math.abs(pct - 100) < 0.001 && amounts.length > 0) {
    const others = amounts.slice(0, -1).reduce((n, a) => n + a, 0)
    amounts[amounts.length - 1] = round(total - others)
  }
  return amounts
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
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const shoot = dated.find((s) => new RegExp(`(^|[^a-z-])${esc(s.name.trim().toLowerCase())}([^a-z-]|$)`).test(t))
  if (!shoot) return null
  if (/\bbefore\b/.test(t)) {
    const d = new Date(`${shoot.shoot_date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 7)
    return { date: d.toISOString().slice(0, 10), why: `7 days before ${shoot.name}` }
  }
  if (/\bafter\b/.test(t)) return null
  return { date: shoot.shoot_date, why: `on ${shoot.name}` }
}

export type DueBucket = 'overdue' | 'soon' | 'later'

export interface DueLine {
  kind: 'invoice' | 'promise' | 'plan' | 'rest'
  label: string
  amount: number
  due_on: string | null
  bucket: DueBucket
  invoice_id?: string
  payment_id?: string
}

/** Overdue before today, "soon" within 30 days, anything later or undated is Later. */
export function dueBucket(dueOn: string | null, today: string): DueBucket {
  if (!dueOn) return 'later'
  if (dueOn < today) return 'overdue'
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 30)
  return dueOn <= d.toISOString().slice(0, 10) ? 'soon' : 'later'
}

/**
 * One project's money still to come in, placed on dates, counting each rupee
 * once: first its open invoices (their balance and due date), then promised
 * payments not tied to an invoice (their expected date), then what is left
 * of the plan's parts in order, by their dates; anything past the plan is
 * Later. Received money pays the plan's parts first to last, and invoices and
 * promises are taken to cover the earliest parts still open.
 */
export function allocateDue({
  outstanding,
  received,
  invoices,
  promises,
  plan,
  today,
}: {
  /** The project's value less what has been received. */
  outstanding: number
  /** What has been received, for walking the plan's parts. */
  received: number
  invoices: readonly { id: string; label: string; balance: number; due_on: string | null }[]
  promises: readonly { id: string; label: string; amount: number; due_on: string | null }[]
  plan: readonly { label: string; amount: number; due_on: string | null }[]
  today: string
}): DueLine[] {
  const lines: DueLine[] = []
  let left = round(Math.max(0, outstanding))
  const take = (amount: number) => {
    const a = round(Math.min(Math.max(0, amount), left))
    left = round(left - a)
    return a
  }
  for (const i of invoices) {
    const a = take(i.balance)
    if (a > 0) lines.push({ kind: 'invoice', label: i.label, amount: a, due_on: i.due_on, bucket: dueBucket(i.due_on, today), invoice_id: i.id })
  }
  for (const p of promises) {
    const a = take(p.amount)
    if (a > 0) lines.push({ kind: 'promise', label: p.label, amount: a, due_on: p.due_on, bucket: dueBucket(p.due_on, today), payment_id: p.id })
  }
  // The plan's parts not yet paid or covered by an invoice or a promise.
  let covered = round(Math.max(0, received) + lines.reduce((n, l) => n + l.amount, 0))
  for (const part of plan) {
    const free = round(Math.max(0, part.amount - covered))
    covered = round(Math.max(0, covered - part.amount))
    const a = take(free)
    if (a > 0) lines.push({ kind: 'plan', label: part.label, amount: a, due_on: part.due_on, bucket: dueBucket(part.due_on, today) })
  }
  if (left > 0.5) lines.push({ kind: 'rest', label: 'Rest of the project value', amount: left, due_on: null, bucket: 'later' })
  return lines
}
