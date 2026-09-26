/**
 * Messaging wallet maths. Every amount is whole paise (integers).
 *
 * The same formulas live in SQL (migration 0186: messaging_price_paise and
 * enqueue_message). The database is what actually charges; these exist so the
 * UI, the API and the tests agree with it to the paisa.
 */

export interface MessagePrice {
  /** What Meta (or the email provider) charges the platform per message. */
  meta_cost_paise: number
  /** Platform markup as a percentage of the cost, e.g. 20 = 20%. */
  markup_pct: number
  /** Flat platform markup added per message. */
  markup_fixed_paise: number
}

/**
 * The price a studio pays for one message: cost + percentage markup + fixed
 * markup. The percentage part rounds UP to the next paisa, so a markup never
 * rounds away to nothing on a cheap message.
 */
export function messagePricePaise(p: MessagePrice): number {
  const cost = Math.max(0, Math.trunc(p.meta_cost_paise))
  const pct = Math.max(0, p.markup_pct)
  const fixed = Math.max(0, Math.trunc(p.markup_fixed_paise))
  // Integer maths first (cost * pct in hundredths) so 0.1 + 0.2 style float
  // error cannot push an exact result up by a paisa.
  const hundredths = Math.round(cost * pct * 100)
  const pctPart = Math.ceil(hundredths / 10000)
  return cost + pctPart + fixed
}

/** The platform's margin on one message at this price. */
export function messageMarginPaise(p: MessagePrice): number {
  return messagePricePaise(p) - Math.max(0, Math.trunc(p.meta_cost_paise))
}

/**
 * What one more email costs this month. The first `freeMonthly` emails in a
 * calendar month are free; after that each one is `pricePaise`.
 */
export function emailChargePaise(usedThisMonth: number, freeMonthly: number, pricePaise: number): { free: boolean; cost: number } {
  if (usedThisMonth < Math.max(0, freeMonthly)) return { free: true, cost: 0 }
  return { free: false, cost: Math.max(0, pricePaise) }
}

/** Free emails left this month. */
export function freeEmailsLeft(usedThisMonth: number, freeMonthly: number): number {
  return Math.max(0, freeMonthly - usedThisMonth)
}

/** Emails a studio may send in a calendar month unless the platform changes it. */
export const DEFAULT_EMAIL_MONTHLY_CAP = 10000

/**
 * What one more email would do right now: go free inside the monthly
 * allowance, cost `pricePaise` from the wallet, wait for a recharge, or be
 * stopped by the studio's monthly cap. Same order as enqueue_message()
 * (0188): the cap first, then the allowance, then the balance.
 */
export type EmailQuote =
  | { kind: 'limit' }
  | { kind: 'free'; freeLeft: number }
  | { kind: 'paid'; cost: number }
  | { kind: 'no_balance'; cost: number }

export function emailQuote(q: {
  monthEmails: number
  cap: number
  freeUsed: number
  freeMonthly: number
  pricePaise: number
  canAfford: boolean
}): EmailQuote {
  if (q.monthEmails >= q.cap) return { kind: 'limit' }
  const c = emailChargePaise(q.freeUsed, q.freeMonthly, q.pricePaise)
  if (c.free) return { kind: 'free', freeLeft: freeEmailsLeft(q.freeUsed, q.freeMonthly) }
  if (c.cost === 0) return { kind: 'paid', cost: 0 }
  return q.canAfford ? { kind: 'paid', cost: c.cost } : { kind: 'no_balance', cost: c.cost }
}

export type PaymentReminderStage = 'before_3' | 'due' | 'after_3' | 'after_10'

/**
 * Which automatic payment reminder goes to the client today: 3 days before
 * the due date, on it, and 3 and 10 days after. Null on every other day.
 * Dates are 'YYYY-MM-DD' (India). Mirrors client_payment_due_stage() in SQL.
 */
export function paymentReminderStage(dueDate: string, today: string): PaymentReminderStage | null {
  const day = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000
  const diff = day(today) - day(dueDate)
  if (diff === -3) return 'before_3'
  if (diff === 0) return 'due'
  if (diff === 3) return 'after_3'
  if (diff === 10) return 'after_10'
  return null
}

/**
 * Whether the wallet can pay `cost`. A wallet never goes below minus the
 * overdraft (0 by default, so never below zero).
 */
export function canAfford(balancePaise: number, costPaise: number, overdraftPaise = 0): boolean {
  return balancePaise - costPaise >= -Math.max(0, overdraftPaise)
}

/** How many whole messages the balance still pays for. */
export function messagesLeft(balancePaise: number, pricePaise: number): number {
  if (pricePaise <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(balancePaise / pricePaise))
}

/** "₹1,234.50" from paise. Whole rupees drop the ".00". */
export function formatPaise(paise: number): string {
  const rupees = paise / 100
  const whole = Number.isInteger(rupees)
  return (
    (paise < 0 ? '-' : '') +
    '₹' +
    Math.abs(rupees).toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
  )
}

/** The highest {{n}} placeholder in a WhatsApp template body (Meta numbers them 1..n). */
export function templatePlaceholderCount(body: string): number {
  let max = 0
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]))
  return max
}

/** Fill {{1}}, {{2}}… with the values; a missing value becomes "-". */
export function fillTemplate(body: string, vars: ReadonlyArray<string>): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => {
    const v = vars[Number(n) - 1]
    return v && v.trim() ? v : '-'
  })
}

/**
 * The parameters to send with a template: exactly as many as its body uses,
 * never blank (Meta refuses an empty parameter), and within Meta's length
 * limit for a parameter.
 */
export function templateParams(body: string, vars: ReadonlyArray<string>): string[] {
  const n = templatePlaceholderCount(body)
  return Array.from({ length: n }, (_, i) => {
    const v = (vars[i] ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim()
    return v ? v.slice(0, 1000) : '-'
  })
}
