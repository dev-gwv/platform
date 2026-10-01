import type { ProjectDetail } from '@ipc/contracts'
import type { InvoiceLineDraft } from './invoice-math'

/**
 * What a project bills, as invoice lines: the package, then each extra the
 * client was quoted and is charged for. Shared by the journey's "Create the
 * invoice" (which fills the whole project in) and the editor's "From the
 * project" buttons, so the two can never disagree about what counts.
 */
export function chargeableDeliverables(p: Pick<ProjectDetail, 'deliverables'>) {
  return p.deliverables.filter(
    (d) => d.visibility_scope === 'client' && d.show_on_quotation && d.status !== 'cancelled' && d.is_additional_charge && d.additional_charge_amount > 0,
  )
}

export function projectInvoiceLines(p: Pick<ProjectDetail, 'name' | 'package_cost' | 'deliverables'>): InvoiceLineDraft[] {
  const base = { quantity: '1', gst_rate: 0 as const }
  const lines: InvoiceLineDraft[] = []
  if (p.package_cost > 0) lines.push({ ...base, description: `${p.name} — Package`, rate: String(p.package_cost) })
  for (const d of chargeableDeliverables(p)) lines.push({ ...base, description: d.title, rate: String(d.additional_charge_amount) })
  return lines
}

/** A payment the project already holds that no invoice has claimed yet. */
export interface AppliedPayment {
  id: string
  amount: number
  paid_on: string
  mode: string | null
  /** Ticked: counts against the invoice being made. */
  on: boolean
}

/** The project's paid, unlinked payments (the wizard's advance), ready to apply. */
export function unappliedPayments(p: Pick<ProjectDetail, 'payments'>): AppliedPayment[] {
  return p.payments
    .filter((x) => x.status !== 'pending' && !x.invoice_id && x.amount > 0)
    .map((x) => ({ id: x.id, amount: x.amount, paid_on: x.paid_on, mode: x.mode, on: true }))
}

export const appliedTotal = (applied: readonly AppliedPayment[]) => applied.filter((a) => a.on).reduce((n, a) => n + a.amount, 0)
