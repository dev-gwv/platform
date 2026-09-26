import { describe, expect, it } from 'vitest'
import { moneyCsv, pctText, salesCsv, sourceLabel, teamCsv } from './csv'

describe('report CSVs', () => {
  it('sales: summary, sources and lost reasons, in plain words', () => {
    const text = salesCsv(
      {
        from: '2026-06-01', to: '2026-06-30', enquiries: 8, booked: 3, conversion_pct: 37.5, bookings: 2, booking_value: 150000,
        sources: [{ source: 'instagram', enquiries: 4, booked: 2 }], lost: 2, lost_reasons: [{ reason: 'Budget, too high', count: 2 }],
      },
      'June 2026',
    )
    expect(text).toContain('Sales June 2026 (2026-06-01 to 2026-06-30)')
    expect(text).toContain('Conversion %,37.5')
    expect(text).toContain('Instagram,4,2')
    expect(text).toContain('"Budget, too high",2')
  })

  it('money: who owes you, with days overdue', () => {
    const text = moneyCsv(
      {
        from: '2026-06-01', to: '2026-06-30', billed: 100000, invoices: 1, received: 60000, to_collect: 115000, overdue: 40000,
        overdue_invoices: 1, expenses: 6180,
        owes: [{ client_id: 'x', client_name: 'Sharma', outstanding: 70000, overdue: 40000, overdue_days: 12, invoice_id: null, project_id: null }],
      } as never,
      'June 2026',
    )
    expect(text).toContain('Billed,100000')
    expect(text).toContain('Sharma,70000,40000,12')
  })

  it('team: one row a person', () => {
    const text = teamCsv(
      { from: '2026-06-01', to: '2026-06-30', members: [{ user_id: 'u', name: 'Crew', shoots: 2, delivered: 2, late_now: 0, days_present: 2, leave_days: 3.5 }] },
      'June 2026',
    )
    expect(text.split('\n')).toContain('Crew,2,2,0,2,3.5')
  })

  it('labels', () => {
    expect(sourceLabel('google_form')).toBe('Google Form')
    expect(sourceLabel('new_thing')).toBe('New thing')
    expect(pctText(null)).toBe('—')
    expect(pctText(50)).toBe('50%')
    expect(pctText(37.5)).toBe('37.5%')
  })
})
