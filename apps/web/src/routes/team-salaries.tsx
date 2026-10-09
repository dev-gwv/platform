import { Navigate } from '@tanstack/react-router'

/**
 * Monthly salaries was a second salary ledger beside Payroll, with its own
 * Generate. It is Payroll's history now; this address opens it there.
 */
export function TeamSalariesPage() {
  return <Navigate to="/payroll" search={{ history: '1' } as never} replace />
}
