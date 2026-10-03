import type { Plan, PlanLimitKey, PlanQuote } from '@ipc/contracts'
import { PER_PERIOD } from './usage'

/**
 * What the pricing page says (owner, 3 Oct: "easy on the eyes, easy to
 * understand"). Every plan has every feature, so the page shows that once as
 * a row of chips, and "Compare plans" lists only what differs -- never a long
 * table. Numbers come from the plan rows, so the page and the database cannot
 * disagree.
 */

/** Everything every plan has, as chips. The icon names are lucide's. */
export const INCLUDED = [
  { label: 'Leads & follow-ups', icon: 'inbox', tone: 'blue' },
  { label: 'Quotations & e-sign', icon: 'file-signature', tone: 'violet' },
  { label: 'GST invoices', icon: 'receipt', tone: 'green' },
  { label: 'Shoots & team booking', icon: 'calendar', tone: 'amber' },
  { label: 'Editing board', icon: 'clapperboard', tone: 'rose' },
  { label: 'Data backup', icon: 'hard-drive', tone: 'teal' },
  { label: 'Attendance & payroll', icon: 'user-check', tone: 'blue' },
  { label: 'Crew payouts', icon: 'wallet', tone: 'green' },
] as const

export type Cell = { kind: 'yes' } | { kind: 'no' } | { kind: 'text'; text: string }

interface CompareRow {
  label: string
  cell: (p: Plan) => Cell
}

const limitCell = (key: PlanLimitKey) => (p: Plan): Cell => {
  const n = p.limits?.[key]
  if (n == null) return { kind: 'text', text: 'Unlimited' }
  if (!PER_PERIOD.has(key)) return { kind: 'text', text: String(n) }
  return { kind: 'text', text: `${n} a ${p.billing_interval === 'monthly' ? 'month' : 'year'}` }
}

const tierIs = (t: Plan['tier']) => (p: Plan): Cell => (p.tier === t ? { kind: 'yes' } : { kind: 'no' })

/** Only the rows that differ between plans, at most nine. */
export const COMPARE: CompareRow[] = [
  { label: 'Projects', cell: limitCell('projects') },
  { label: 'Leads (enquiries always come in)', cell: limitCell('leads') },
  { label: 'GST invoices', cell: limitCell('invoices') },
  { label: 'Team logins', cell: limitCell('team_logins') },
  { label: 'Team without a login', cell: limitCell('team_members') },
  { label: 'Enquiry forms', cell: limitCell('enquiry_forms') },
  { label: 'Facebook Pages', cell: limitCell('facebook_pages') },
  {
    label: 'WhatsApp & email in your own name',
    cell: (p) => (p.includes?.includes('white_label') ? { kind: 'yes' } : { kind: 'no' }),
  },
  { label: 'Priority help', cell: tierIs('max') },
]

/** The three plans for one way of paying, cheapest first. */
export function tierPlans(plans: Plan[], payEvery: 'yearly' | 'monthly'): Plan[] {
  const rank = { starter: 1, pro: 2, max: 3 } as const
  return plans
    .filter((p) => p.tier && p.billing_interval === payEvery)
    .sort((a, b) => rank[a.tier!] - rank[b.tier!])
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/**
 * What the button on a plan says, and the one line under it. An upgrade
 * costs only the difference; a lower plan waits for the current one to end.
 */
export function quoteWords(p: Plan, q: PlanQuote | undefined, inr: (n: number) => string): { button: string; line: string | null; disabled: boolean } {
  const name = p.name
  if (!q || q.kind === 'buy') return { button: `Choose ${name}`, line: null, disabled: false }
  if (q.kind === 'renew') return { button: `Renew ${name}`, line: 'Adds on from the day your plan ends.', disabled: false }
  if (q.kind === 'upgrade') {
    return {
      button: `Upgrade to ${name}`,
      line: `${inr(q.amount)} today with GST · ${inr(q.credit)} left on ${q.current_name ?? 'your plan'} comes off`,
      disabled: false,
    }
  }
  return {
    button: q.blocked_until ? `From ${shortDate(q.blocked_until)}` : 'Later',
    line: `When your ${q.current_name ?? 'current'} plan ends`,
    disabled: true,
  }
}
