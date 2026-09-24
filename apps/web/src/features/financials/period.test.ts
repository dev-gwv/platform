import { describe, expect, it } from 'vitest'
import { periodFor, rangeLabel } from './period'

const on = (s: string) => new Date(`${s}T12:00:00`)

describe('periods', () => {
  it('months', () => {
    expect(periodFor('this_month', on('2026-09-24'))).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    expect(periodFor('last_month', on('2026-01-10'))).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodFor('this_month', on('2028-02-10')).to).toBe('2028-02-29')
  })

  it('quarters of the April-March year', () => {
    expect(periodFor('this_quarter', on('2026-09-24'))).toMatchObject({ from: '2026-07-01', to: '2026-09-30', label: 'Q2 FY 2026-27' })
    expect(periodFor('this_quarter', on('2026-02-01'))).toMatchObject({ from: '2026-01-01', to: '2026-03-31', label: 'Q4 FY 2025-26' })
    expect(periodFor('last_quarter', on('2026-04-15'))).toMatchObject({ from: '2026-01-01', to: '2026-03-31', label: 'Q4 FY 2025-26' })
  })

  it('financial years run April to March', () => {
    expect(periodFor('this_fy', on('2026-09-24'))).toMatchObject({ from: '2026-04-01', to: '2027-03-31', label: 'FY 2026-27' })
    expect(periodFor('this_fy', on('2026-03-31'))).toMatchObject({ from: '2025-04-01', to: '2026-03-31' })
    expect(periodFor('last_fy', on('2026-09-24'))).toMatchObject({ from: '2025-04-01', to: '2026-03-31', label: 'FY 2025-26' })
  })

  it('labels a custom range', () => {
    expect(rangeLabel('2026-06-01', '2026-06-30')).toMatch(/1 Jun – 30 Jun 2026/)
  })
})
