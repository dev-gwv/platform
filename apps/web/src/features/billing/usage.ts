import { PLAN_LIMIT_KEYS, type PlanLimitKey, type PlanUsage } from '@ipc/contracts'

/**
 * A plan's limits as bars (0241): only the ones the plan has, each with its
 * sentence ("4 of 8 projects this month"). An unlimited plan or a trial has
 * no bars at all.
 */
const WORDS: Record<PlanLimitKey, (n: number) => string> = {
  projects_per_month: (n) => `project${n === 1 ? '' : 's'} this month`,
  invoices_per_month: (n) => `invoice${n === 1 ? '' : 's'} this month`,
  team_logins: (n) => `team login${n === 1 ? '' : 's'}`,
  enquiry_forms: (n) => `enquiry form${n === 1 ? '' : 's'}`,
}

export interface UsageBar {
  key: PlanLimitKey
  used: number
  limit: number
  /** 0..1, for the bar's width. */
  share: number
  line: string
  tone: 'calm' | 'near' | 'full'
}

export function usageBars(u: PlanUsage | undefined): UsageBar[] {
  if (!u) return []
  return PLAN_LIMIT_KEYS.flatMap((key) => {
    const limit = u.limits[key]
    if (limit == null) return []
    const used = u.used[key]
    const share = limit > 0 ? Math.min(1, used / limit) : 1
    return [{ key, used, limit, share, line: `${used} of ${limit} ${WORDS[key](limit)}`, tone: used >= limit ? 'full' : share >= 0.8 ? 'near' : 'calm' }]
  })
}

/** The one bar worth a line on the sidebar card: the fullest one at 80% or more. */
export function nearestLimit(u: PlanUsage | undefined): UsageBar | null {
  const close = usageBars(u).filter((b) => b.tone !== 'calm')
  return close.sort((a, b) => b.share - a.share)[0] ?? null
}
