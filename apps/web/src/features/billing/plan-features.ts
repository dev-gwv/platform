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
  // Counted by the plan year on a monthly plan too (0267): never "3 a month".
  // Leads are the ones held now (0289), never a yearly count.
  return { kind: 'text', text: PER_PERIOD.has(key) ? `${n} a year` : key === 'leads' ? `${n} at a time` : String(n) }
}

const tierIs = (t: Plan['tier']) => (p: Plan): Cell => (p.tier === t ? { kind: 'yes' } : { kind: 'no' })

const has = (key: string) => (p: Plan): Cell => (p.includes?.includes(key) ? { kind: 'yes' } : { kind: 'no' })
const every: CompareRow['cell'] = () => ({ kind: 'yes' })
const text = (t: string): CompareRow['cell'] => () => ({ kind: 'text', text: t })

/** Storage: Starter's 2 GB, said in GB. */
const storageCell = (p: Plan): Cell => {
  const mb = p.limits?.storage_mb
  return mb == null ? { kind: 'text', text: 'Unlimited' } : { kind: 'text', text: mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${mb} MB` }
}

/**
 * What each plan gives, in sections (owner, 17 Nov: "added features rows and columns so users know what they get
 * in each plan and at what are the Frameline limits"). This replaces 3 Oct's "only the rows that differ": the
 * table stays closed until Compare plans is pressed. Numbers come from the plan rows.
 */
export const COMPARE_GROUPS: { title: string; rows: CompareRow[] }[] = [
  {
    title: 'What you can make',
    rows: [
      { label: 'Projects', cell: limitCell('projects') },
      { label: 'GST invoices', cell: limitCell('invoices') },
      { label: 'Leads held at a time', cell: limitCell('leads') },
      { label: 'Quotation Designer designs', cell: limitCell('designs') },
      { label: 'Saved packages', cell: limitCell('packages') },
      { label: 'File storage', cell: storageCell },
    ],
  },
  {
    title: 'Your team',
    rows: [
      { label: 'Team logins', cell: limitCell('team_logins') },
      { label: 'Crew (no login)', cell: limitCell('team_members') },
      // 0276: more than one studio (a maternity brand beside the wedding one) on one login.
      { label: 'Brands on one login', cell: (p) => ({ kind: 'text', text: p.limits?.brands == null ? 'Unlimited' : String(p.limits.brands) }) },
    ],
  },
  {
    title: 'Getting leads',
    rows: [
      { label: 'Enquiry forms (your main form is free)', cell: limitCell('enquiry_forms') },
      { label: 'Facebook lead ad Pages', cell: limitCell('facebook_pages') },
      { label: 'Follow-ups that send by themselves', cell: has('sequences_auto') },
      { label: 'Your own WhatsApp Business number', cell: has('whatsapp_api') },
    ],
  },
  {
    // 0292, 0307: the gallery is Frameline; Drive galleries are included in Pro and up, up to these photos kept.
    title: 'Photo sharing (Frameline gallery)',
    rows: [
      { label: 'Galleries with a link, PIN and QR', cell: every },
      { label: 'Import from Google Drive', cell: has('drive_import') },
      {
        label: 'Google Drive gallery photos included',
        cell: (p) =>
          !p.includes?.includes('drive_import')
            ? { kind: 'no' }
            : p.limits?.gallery_photos
              ? { kind: 'text', text: `${p.limits.gallery_photos.toLocaleString('en-IN')} photos` }
              : { kind: 'yes' },
      },
      { label: 'More gallery photos', cell: (p) => (p.includes?.includes('drive_import') ? { kind: 'text', text: 'Ask us' } : { kind: 'no' }) },
      { label: 'Uploads from a computer or phone', cell: text('Frameline plan') },
    ],
  },
  {
    title: 'In every plan',
    rows: [
      { label: 'AI tools: designer, replies, captions, ad scripts', cell: every },
      { label: 'Shoots, crew booking and payouts', cell: every },
      { label: 'Attendance, leave and payroll', cell: every },
      { label: 'Client tracking page and e-sign', cell: every },
    ],
  },
  {
    title: 'Extras',
    rows: [
      { label: 'Your own name and logo (white label)', cell: has('white_label') },
      { label: 'Priority help', cell: tierIs('max') },
    ],
  },
]

/** Every row, in order. */
export const COMPARE: CompareRow[] = COMPARE_GROUPS.flatMap((g) => g.rows)

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

/**
 * Buying a plan is a conversation for now (owner, 10 Oct: "we can arrange a
 * call for the time being"): the plan's button opens WhatsApp to support
 * with this already written, the studio presses Send, and the platform owner
 * gives the plan in Studio Access Manager. Prices are our own, so the words
 * carry formatINR, never the masked figure.
 */
export function planEnquiryMessage(c: {
  plan: Pick<Plan, 'name' | 'price' | 'billing_interval'>
  kind?: PlanQuote['kind'] | undefined
  studio: string
  name: string
  email: string | null | undefined
  inr: (n: number) => string
  /** A verified IPC Diamond member: the message says so, so we price it right on the call. */
  diamond?: boolean | undefined
  /** The studio's personal offer (0268): the message names it and the price after it. */
  offer?: { percent: number; lastDay: string } | undefined
}): string {
  const how =
    c.plan.billing_interval === 'monthly' ? 'paid monthly' : c.plan.billing_interval === 'biennial' ? 'for 2 years' : 'paid yearly'
  const want =
    c.kind === 'upgrade' ? `to upgrade to the ${c.plan.name} plan` : c.kind === 'renew' ? `to renew the ${c.plan.name} plan` : `the ${c.plan.name} plan`
  return [
    `Hi Studio AutoPilot team, I'm ${c.name || 'the owner'} from ${c.studio}.`,
    `I'd like ${want}, ${how} (${c.inr(c.plan.price)} + 18% GST)${c.diamond ? ', at the IPC Diamond member price' : ''}.`,
    ...(c.offer
      ? [`With my ${c.offer.percent}% offer (until ${c.offer.lastDay}): ${c.inr(Math.round((c.plan.price * (100 - c.offer.percent)) / 100))} + 18% GST.`]
      : []),
    ...(c.email ? [`Login: ${c.email}`] : []),
    'Please call me to set it up.',
  ].join('\n')
}
