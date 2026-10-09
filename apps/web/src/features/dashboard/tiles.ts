/**
 * The plain line under each dashboard number, so the number says what it
 * means: "2 shoots this week", "All on track", "from 3 invoices · 1 overdue".
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Shoots from today to six days on, leaving out cancelled ones. */
export function shootsWeekLine(shoots: readonly { shoot_date: string | null; status: string }[], today: string): string {
  const end = addDays(today, 6)
  const n = shoots.filter((s) => s.status !== 'cancelled' && !!s.shoot_date && s.shoot_date >= today && s.shoot_date <= end).length
  return n ? `${plural(n, 'shoot')} this week` : 'No shoots this week'
}

/** Under "Need attention": what kind of trouble, or that there is none. */
export function attentionLine(t: { attention: number; overdue: number }): string {
  if (t.attention === 0) return 'Nothing urgent'
  return t.overdue > 0 ? `${plural(t.overdue, 'project')} with late work` : 'Open Project Tracking'
}

/** Under "To collect": how many invoices, and how many are past their date. */
export function collectLine(invoices: readonly { balance_due: number; due_date: string | null; status: string }[], today: string): string {
  const open = invoices.filter((i) => i.balance_due > 0 && i.status !== 'cancelled' && i.status !== 'draft')
  if (!open.length) return 'Nothing waiting'
  const late = open.filter((i) => !!i.due_date && i.due_date < today).length
  return `from ${plural(open.length, 'invoice')}${late ? ` · ${late} overdue` : ''}`
}

/**
 * The three tiles of the studio's Home (the audit, owner's yes): each a
 * number, one sentence under it, and the one place to act.
 */

/** Leads: who is owed a call today, and how many were never rung. */
export function leadsTileLine(queue: readonly { last_contacted_at: string | null }[]): string {
  if (!queue.length) return 'Nobody to call today'
  const fresh = queue.filter((l) => !l.last_contacted_at).length
  return `${queue.length} to call today${fresh ? ` · ${fresh} not contacted yet` : ''}`
}

/** Shoots this week: how many, and how many still need people. */
export function shootsTile(
  shoots: readonly { id: string; shoot_date: string | null; status: string }[],
  short: (shootId: string) => boolean,
  today: string,
): { count: number; short: number; line: string } {
  const end = addDays(today, 6)
  const week = shoots.filter((s) => s.status !== 'cancelled' && !!s.shoot_date && s.shoot_date >= today && s.shoot_date <= end)
  const need = week.filter((s) => short(s.id)).length
  const line = !week.length ? 'No shoots this week' : need ? `${need} still ${need === 1 ? 'needs' : 'need'} people` : 'Every day has its team'
  return { count: week.length, short: need, line }
}

/**
 * Money: what is due in the next 30 days (overdue included), the same rule
 * as Payments received -- invoices, promises and the payment plan, each rupee
 * once -- so the dashboard and that page never show two "to collect" numbers.
 */
export function moneyTile(
  due: { overdue: { amount: number }; soon: { amount: number } },
  inr: (n: number) => string,
): { amount: number; line: string } {
  const amount = due.overdue.amount + due.soon.amount
  if (!amount) return { amount, line: 'Nothing due in 30 days' }
  return {
    amount,
    line: due.overdue.amount ? `${inr(due.soon.amount)} due in 30 days · ${inr(due.overdue.amount)} overdue` : 'due in the next 30 days',
  }
}
