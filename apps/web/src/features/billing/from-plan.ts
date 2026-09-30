import type { PlanInstalment } from '@ipc/contracts'
import { planStatus } from './plan'

/**
 * The plan to bill by when the client has not been sent terms yet: the same
 * 30 / 30 / 30 / 10 the terms start from, so the invoice and the terms agree.
 */
export const DEFAULT_PLAN: readonly PlanInstalment[] = [
  { label: 'Booking amount', mode: 'percent', value: 30, due_trigger: 'On signing' },
  { label: 'Before first shoot', mode: 'percent', value: 30, due_trigger: 'Before the first shoot' },
  { label: 'Before final shoot', mode: 'percent', value: 30, due_trigger: 'Before the final shoot' },
  { label: 'On delivery', mode: 'percent', value: 10, due_trigger: 'On delivery' },
]

export interface NextInvoice {
  /** "Booking amount" */
  label: string
  amount: number
  /** "Booking amount — Pulkit Wedding", for the invoice's subject and its one line. */
  description: string
  /** True when it came from the default plan, not terms the client was sent. */
  fromDefault: boolean
}

/**
 * The next part of the plan to invoice: the first one neither paid nor
 * already invoiced. After the quotation this is the booking amount; later,
 * the next instalment. Null when every part is covered.
 */
export function nextInvoiceFromPlan({
  projectName,
  total,
  instalments,
  received,
  invoiced,
}: {
  projectName: string
  total: number
  /** The plan the client agreed to, or null when no terms were sent. */
  instalments: readonly PlanInstalment[] | null
  received: number
  invoiced: number
}): NextInvoice | null {
  if (!(total > 0)) return null
  const fromDefault = !instalments || instalments.length === 0
  const rows = planStatus({ instalments: fromDefault ? DEFAULT_PLAN : instalments, total, received, invoiced })
  const next = rows.find((r) => r.state === 'due' || r.state === 'upcoming')
  if (!next) return null
  const amount = Math.max(0, next.amount - Math.max(next.received, next.invoiced))
  if (amount <= 0) return null
  return { label: next.label, amount, description: `${next.label} — ${projectName}`, fromDefault }
}
