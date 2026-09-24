import { Navigate } from '@tanstack/react-router'

/**
 * Billing has no page of its own any more: it is Invoices, Payments received,
 * Expenses and Profit & Loss. Old links land on Invoices, and the older
 * `?tab=payments` on Payments.
 */
export function BillingPage() {
  const tab = new URLSearchParams(window.location.search).get('tab')
  return <Navigate to={tab === 'payments' ? '/billing/payments' : '/billing/invoices'} replace />
}
