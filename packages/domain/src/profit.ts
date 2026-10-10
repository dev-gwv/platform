import { roundINR, sumINR } from './money'

/**
 * Project profit (authoritative, from PROJECT_PROFIT_LOGIC_SEPARATION):
 *   Gross Profit = Revenue − Direct team cost − Project expenses
 * Revenue is the booked/contract value (projects.total_cost), NOT payment date.
 */
export interface ProfitInputs {
  revenue: number
  directTeamCost: number
  projectExpenses: number
}

export function grossProfit(i: ProfitInputs): number {
  return roundINR(i.revenue - i.directTeamCost - i.projectExpenses)
}

export function balancePending(revenue: number, received: number): number {
  return roundINR(Math.max(0, revenue - received))
}

export type AllocationMethod = 'equal' | 'revenue_weighted' | 'shoot_days_weighted'

export interface AllocationProject {
  id: string
  revenue: number
  shootDays: number
}

/**
 * Distribute a fixed-overhead pool across eligible projects.
 *   equal              = pool ÷ n
 *   revenue_weighted   = (project revenue ÷ Σ revenue) × pool
 *   shoot_days_weighted= (project shoot days ÷ Σ shoot days) × pool
 * Returns id → allocated amount. Empty input or a zero weight-basis yields 0s.
 */
export function allocateOverhead(
  pool: number,
  projects: ReadonlyArray<AllocationProject>,
  method: AllocationMethod,
): Record<string, number> {
  const out: Record<string, number> = {}
  const n = projects.length
  if (n === 0) return out

  if (method === 'equal') {
    const each = roundINR(pool / n)
    for (const p of projects) out[p.id] = each
    return out
  }

  const basis = method === 'revenue_weighted' ? (p: AllocationProject) => p.revenue : (p: AllocationProject) => p.shootDays
  const total = sumINR(projects.map(basis))
  for (const p of projects) {
    out[p.id] = total > 0 ? roundINR((basis(p) / total) * pool) : 0
  }
  return out
}
