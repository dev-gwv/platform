import { describe, expect, it } from 'vitest'
import { invoiceMessage } from './share'

const inv = {
  id: '00000000-0000-4000-8000-000000000001',
  invoice_number: 'INV-012',
  total: 100000,
  balance_due: 40000,
  due_date: '2026-09-01',
  client_name: 'Riya Sharma',
  project_name: 'Riya & Aman Wedding',
}

describe('invoice messages', () => {
  it('reminds with what is due, when, and the link', () => {
    const text = invoiceMessage(inv, 'https://x/invoice?token=t', true)
    expect(text).toContain('Hi Riya,')
    expect(text).toContain('40,000')
    expect(text).toContain('INV-012 for Riya & Aman Wedding')
    expect(text).toContain('https://x/invoice?token=t')
  })

  it('sends a first invoice with its total', () => {
    const text = invoiceMessage({ ...inv, balance_due: 100000 }, 'L', false)
    expect(text).toContain('1,00,000')
    expect(text).not.toContain('still due')
  })
})
