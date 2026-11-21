import { z } from 'zod'

/**
 * GET /dashboard/summary: the numbers behind the studio Home's tiles, without
 * the lists behind them. A part the caller may not see (no CRM, no projects) is
 * null. Money stays on GET /billing/due, the one rule Payments received uses.
 * Every part defaults, so a web build and an API build a few minutes apart
 * never break each other.
 */
export const dashboardSummary = z.object({
  /** Today's calls for the caller's scope (all for whoever runs the CRM, else their own). */
  leads: z.object({ to_call: z.number().int(), not_contacted: z.number().int() }).nullable().default(null),
  /** Shoots from today to six days on, and how many still need people. */
  shoots: z.object({ count: z.number().int(), short: z.number().int() }).nullable().default(null),
})
export type DashboardSummary = z.infer<typeof dashboardSummary>
