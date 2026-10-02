import { describe, expect, it } from 'vitest'
import { allocateDue, dueBucket, instalmentAmounts } from './payment-plan'

const today = '2026-10-02'

describe('dueBucket', () => {
  it('overdue before today, soon within 30 days, later after or undated', () => {
    expect(dueBucket('2026-10-01', today)).toBe('overdue')
    expect(dueBucket('2026-10-02', today)).toBe('soon')
    expect(dueBucket('2026-11-01', today)).toBe('soon')
    expect(dueBucket('2026-11-02', today)).toBe('later')
    expect(dueBucket(null, today)).toBe('later')
  })
})

describe('allocateDue', () => {
  const plan = instalmentAmounts(
    [
      { label: 'Advance', mode: 'percent', value: 30, due_trigger: null },
      { label: 'Before the wedding', mode: 'percent', value: 50, due_trigger: null },
      { label: 'On delivery', mode: 'percent', value: 20, due_trigger: null },
    ],
    100000,
  ).map((amount, i) => ({ label: ['Advance', 'Before the wedding', 'On delivery'][i]!, amount, due_on: ['2026-09-01', '2026-10-20', null][i]! }))

  it('counts every rupee once: invoice, then promise, then the plan by date', () => {
    const lines = allocateDue({
      outstanding: 70000,
      received: 30000,
      invoices: [{ id: 'i1', label: 'INV-1', balance: 20000, due_on: '2026-09-25' }],
      promises: [{ id: 'p1', label: 'Promised', amount: 10000, due_on: '2026-10-10' }],
      plan,
      today,
    })
    expect(lines.map((l) => [l.kind, l.amount, l.bucket])).toEqual([
      ['invoice', 20000, 'overdue'],
      ['promise', 10000, 'soon'],
      ['plan', 20000, 'soon'],
      ['plan', 20000, 'later'],
    ])
    expect(lines.reduce((n, l) => n + l.amount, 0)).toBe(70000)
  })

  it('never shows more than is outstanding, and puts what is past the plan in Later', () => {
    const over = allocateDue({ outstanding: 5000, received: 95000, invoices: [{ id: 'i', label: 'INV', balance: 9000, due_on: null }], promises: [], plan, today })
    expect(over).toEqual([{ kind: 'invoice', label: 'INV', amount: 5000, due_on: null, bucket: 'later', invoice_id: 'i' }])
    const noPlan = allocateDue({ outstanding: 40000, received: 0, invoices: [], promises: [], plan: [], today })
    expect(noPlan).toEqual([{ kind: 'rest', label: 'Rest of the project value', amount: 40000, due_on: null, bucket: 'later' }])
  })
})
