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
