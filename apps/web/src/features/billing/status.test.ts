import { describe, expect, it } from 'vitest'
import { dueText, invoiceBadge, isOverdue } from './status'

const inv = (status: string, balance_due: number, due_date: string | null) => ({ status, balance_due, due_date })

describe('invoice status', () => {
  it('calls a sent invoice past its due date with money owed overdue', () => {
    expect(isOverdue(inv('sent', 1000, '2026-09-01'), '2026-09-10')).toBe(true)
    expect(isOverdue(inv('partial', 1000, '2026-09-01'), '2026-09-10')).toBe(true)
    expect(isOverdue(inv('draft', 1000, '2026-09-01'), '2026-09-10')).toBe(false)
    expect(isOverdue(inv('cancelled', 1000, '2026-09-01'), '2026-09-10')).toBe(false)
    expect(isOverdue(inv('paid', 0, '2026-09-01'), '2026-09-10')).toBe(false)
  })

  it('labels each state', () => {
    expect(invoiceBadge(inv('sent', 1000, '2026-09-01'), '2026-09-10')).toEqual({ label: 'Overdue', tone: 'danger' })
    expect(invoiceBadge(inv('partial', 500, '2026-09-20'), '2026-09-10').label).toBe('Part paid')
    expect(invoiceBadge(inv('paid', 0, null)).label).toBe('Paid')
    expect(invoiceBadge(inv('draft', 1000, null)).label).toBe('Draft')
    expect(invoiceBadge(inv('cancelled', 1000, null)).label).toBe('Cancelled')
  })

  it('says when it is due', () => {
    expect(dueText(inv('sent', 1, '2026-09-10'), '2026-09-10')).toBe('Due today')
    expect(dueText(inv('sent', 1, '2026-09-13'), '2026-09-10')).toBe('Due in 3 days')
    expect(dueText(inv('sent', 1, '2026-09-09'), '2026-09-10')).toBe('1 day late')
    expect(dueText(inv('paid', 0, '2026-09-09'), '2026-09-10')).toBeNull()
  })
})
