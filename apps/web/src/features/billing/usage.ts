import { PLAN_LIMIT_KEYS, type PlanLimitKey, type PlanUsage } from '@ipc/contracts'

/**
 * A plan's limits as bars (0242): only the ones the plan has, each with its
 * sentence ("12 of 30 projects this year"). Projects, leads and invoices count
 * in the studio's plan year (from the day it paid); the rest as they stand.
 * An unlimited plan or a trial has no bars at all.
 */
const WORDS: Record<PlanLimitKey, (n: number, period: 'year' | 'month') => string> = {
  projects: (n, p) => `project${n === 1 ? '' : 's'} this ${p}`,
  leads: (n, p) => `lead${n === 1 ? '' : 's'} this ${p}`,
  invoices: (n, p) => `GST invoice${n === 1 ? '' : 's'} this ${p}`,
  team_logins: (n) => `team login${n === 1 ? '' : 's'}`,
  team_members: () => 'team without a login',
  enquiry_forms: (n) => `enquiry form${n === 1 ? '' : 's'}`,
  facebook_pages: (n) => `Facebook Page${n === 1 ? '' : 's'}`,
  packages: (n) => `saved package${n === 1 ? '' : 's'}`,
  storage_mb: () => 'GB of uploads',
}

/** The keys that count in the plan year; the rest count what stands now. */
export const PER_PERIOD: ReadonlySet<PlanLimitKey> = new Set(['projects', 'leads', 'invoices'])

interface UsageBar {
  key: PlanLimitKey
  used: number
  limit: number
  /** 0..1, for the bar's width. */
  share: number
  line: string
  tone: 'calm' | 'near' | 'full'
}

const gb = (mb: number) => (Math.round((mb / 1024) * 10) / 10).toString()

export function usageBars(u: PlanUsage | undefined): UsageBar[] {
  if (!u) return []
  return PLAN_LIMIT_KEYS.flatMap((key) => {
    const limit = u.limits[key]
    if (limit == null) return []
    const used = u.used[key]
    const share = limit > 0 ? Math.min(1, used / limit) : 1
    const line =
      key === 'storage_mb'
        ? `${gb(used)} of ${gb(limit)} ${WORDS[key](limit, u.period)}`
        : `${used} of ${limit} ${WORDS[key](limit, u.period)}`
    return [{ key, used, limit, share, line, tone: used >= limit ? 'full' : share >= 0.8 ? 'near' : 'calm' }]
  })
}

/** The one bar worth a line on the sidebar card: the fullest one at 80% or more. */
export function nearestLimit(u: PlanUsage | undefined): UsageBar | null {
  const close = usageBars(u).filter((b) => b.tone !== 'calm')
  return close.sort((a, b) => b.share - a.share)[0] ?? null
}

const dayMonthYear = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** "Counts start again on 15 Oct 2027": the plan year follows the day the studio paid. */
export function windowLine(u: PlanUsage | undefined): string | null {
  if (!u?.window_ends || !Object.keys(u.limits).some((k) => PER_PERIOD.has(k as PlanLimitKey))) return null
  return `Counts start again on ${dayMonthYear(u.window_ends)}`
}

/** "₹82 a day" for a plan paid up front (yearly or longer); none for monthly. */
export function perDay(p: { price: number; duration_days?: number | null | undefined; billing_interval: string }): number | null {
  if (p.billing_interval === 'monthly' || !p.duration_days || p.duration_days < 300) return null
  return Math.round(p.price / p.duration_days)
}
