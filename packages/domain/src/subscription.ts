/**
 * Where the plan on an account actually came from.
 *
 * Both a studio three days into its free trial and a studio that has paid
 * for two years read "Plan: Active". The gate says whether the doors are
 * open; it says nothing about who opened them, which is the question being
 * asked when support is on the phone about a renewal.
 */
export type PlanGate = 'active' | 'grandfathered' | 'grace' | 'expired'
export type PlanSource = 'paid' | 'trial' | 'grandfathered' | 'grace' | 'none'

/** An order as the status endpoint reads it — only the fields that matter here. */
export type PlanOrder = { status?: string | null | undefined }

/** Whether an order actually moved money. */
const isPaid = (o: PlanOrder): boolean => {
  const s = (o.status ?? '').toLowerCase()
  return s === 'paid' || s === 'captured' || s === 'completed' || s === 'success'
}

/**
 * Grandfathering and grace both describe how the account is being kept open,
 * so they answer the question directly. Otherwise an account that is open
 * and has never had a successful payment is on its trial.
 */
export function planSource(gate: PlanGate, orders: readonly PlanOrder[], planName?: string | null): PlanSource {
  if (gate === 'grandfathered') return 'grandfathered'
  if (gate === 'grace') return 'grace'
  if (orders.some(isPaid)) return 'paid'
  // A plan from the catalogue given in Studio Access Manager: buying is a
  // WhatsApp conversation (0256), so most plans have no online order at all.
  if (gate === 'active' && planName) return 'paid'
  return gate === 'active' ? 'trial' : 'none'
}

/** How it reads on screen. */
export const PLAN_SOURCE_LABEL: Record<PlanSource, string> = {
  paid: 'Paid subscription',
  trial: 'Free trial',
  grandfathered: 'Grandfathered',
  grace: 'Grace period',
  none: 'No active plan',
}
