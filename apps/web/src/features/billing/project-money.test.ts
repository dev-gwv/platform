import { describe, expect, it } from 'vitest'
import { projectMoneyChecks } from './project-money'

const inv = (over: Partial<Parameters<typeof projectMoneyChecks>[1][number]> = {}) => ({
  id: 'i1',
  invoice_number: 'INV-0002',
  status: 'sent',
  due_date: '2026-09-26',
  total: 150000,
  taxable: 150000,
  balance_due: 150000,
  ...over,
})

describe('projectMoneyChecks', () => {
  it("names the owner's case: a payment not against the invoice, invoiced past the package, and overdue", () => {
    const checks = projectMoneyChecks(100000, [inv()], [{ id: 'p1', amount: 50000, status: 'paid', invoice_id: null }], '2026-09-28')
    expect(checks.map((c) => c.kind)).toEqual(['unlinked', 'over_invoiced', 'overdue'])
    expect(checks[0]).toMatchObject({ paymentId: 'p1', invoiceNumber: 'INV-0002', amount: 50000 })
    expect(checks[1]).toMatchObject({ invoiced: 150000, agreed: 100000 })
    expect(checks[2]).toMatchObject({ late: '2 days late' })
  })

  it('is quiet when the money adds up', () => {
    const checks = projectMoneyChecks(
      100000,
      [inv({ total: 100000, taxable: 100000, balance_due: 50000, due_date: '2026-10-30', status: 'partial' })],
      [{ id: 'p1', amount: 50000, status: 'paid', invoice_id: 'i1' }],
      '2026-09-28',
    )
    expect(checks).toEqual([])
  })

  it('does not count GST as over-invoicing, nor promised money as loose', () => {
    const checks = projectMoneyChecks(
      100000,
      [inv({ total: 118000, taxable: 100000, balance_due: 118000, due_date: null })],
      [{ id: 'p1', amount: 50000, status: 'pending', invoice_id: null }],
    )
    expect(checks).toEqual([])
  })

  it('does not suggest attaching a payment bigger than what the invoice still owes', () => {
    const checks = projectMoneyChecks(100000, [inv({ taxable: 20000, total: 20000, balance_due: 20000, due_date: null })], [{ id: 'p1', amount: 50000, invoice_id: null }])
    expect(checks).toEqual([])
  })
})
