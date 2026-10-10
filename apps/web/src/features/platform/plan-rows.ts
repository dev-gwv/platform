import type { PlatformPlan } from '@ipc/contracts'
import { formatINR } from '@/shared/ui/format'

/** "₹17,988 a year", "₹1,999 a month", "₹33,000 for 2 years". Our own prices: never masked. */
export function priceWords(p: Pick<PlatformPlan, 'price' | 'billing_interval'>): string {
  const per = p.billing_interval === 'monthly' ? ' a month' : p.billing_interval === 'biennial' ? ' for 2 years' : ' a year'
  return `${formatINR(p.price)}${per}`
}

/**
 * A plan's limits in one line, the counted ones first:
 * "30 projects, 300 leads, 60 invoices a year · 3 logins · 20 crew".
 * No limits is "Unlimited".
 */
export function limitWords(p: Pick<PlatformPlan, 'limits' | 'billing_interval'>): string {
  const l = p.limits ?? {}
  const counted = [
    l['projects'] != null ? `${l['projects']} projects` : null,
    l['leads'] != null ? `${l['leads']} leads` : null,
    l['invoices'] != null ? `${l['invoices']} invoices` : null,
  ].filter(Boolean)
  const per = p.billing_interval === 'monthly' ? ' a month' : ' a year'
  const parts = [
    counted.length ? counted.join(', ') + per : null,
    l['team_logins'] != null ? `${l['team_logins']} logins` : null,
    l['team_members'] != null ? `${l['team_members']} crew` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Unlimited'
}

/**
 * A plan's name where both audiences and both ways of paying sit in one
 * list: "Starter, yearly", "Member Monthly", "₹1,00,000 plan (old)".
 */
export function planLabel(p: Pick<PlatformPlan, 'name' | 'billing_interval' | 'audience' | 'tier'>): string {
  if (p.audience === 'diamond') return `Member ${p.name}`
  if (!p.tier) return `${p.name} (old)`
  return `${p.name}, ${p.billing_interval === 'monthly' ? 'monthly' : 'yearly'}`
}

export const AUDIENCES = [
  { key: 'outsider', label: 'For studios outside IPC' },
  { key: 'diamond', label: 'For IPC Diamond members' },
] as const

/** The catalogue by audience, each in the order a studio reads it. */
export function byAudience(plans: PlatformPlan[]) {
  return AUDIENCES.map((a) => ({
    ...a,
    plans: plans
      .filter((p) => (p.audience ?? 'diamond') === a.key)
      .sort((x, y) => Number(y.is_active) - Number(x.is_active) || (x.sort_order ?? 0) - (y.sort_order ?? 0) || x.price - y.price),
  })).filter((g) => g.plans.length > 0)
}
