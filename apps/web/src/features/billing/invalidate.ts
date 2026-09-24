import type { QueryClient } from '@tanstack/react-query'

/**
 * Money moved: refresh every screen that shows it.
 *
 * A payment recorded on an invoice changes that invoice, the project it
 * belongs to, the payments list, the Billing overview and the Profit & Loss.
 * Each screen used to refresh only its own list, so the others kept showing
 * the old balance until a reload.
 */
export function invalidateMoney(qc: QueryClient) {
  for (const queryKey of [['invoices'], ['received-payments'], ['billing', 'overview'], ['projects'], ['financials'], ['dashboard']]) {
    void qc.invalidateQueries({ queryKey })
  }
}
