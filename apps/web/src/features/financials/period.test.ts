import { describe, expect, it } from 'vitest'
import { PERIOD_CHOICES, choiceLabel, parsePeriodChoice, periodFor, rangeLabel, resolvePeriod } from './period'

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

describe('period choices', () => {
  it('reads only the choices it knows', () => {
    expect(parsePeriodChoice('this_fy')).toBe('this_fy')
    expect(parsePeriodChoice('all')).toBe('all')
    expect(parsePeriodChoice('custom')).toBe('custom')
    expect(parsePeriodChoice('yesterday')).toBeNull()
    expect(parsePeriodChoice('')).toBeNull()
  })
  it('resolves All time, a custom range and a preset', () => {
    const today = new Date(2026, 9, 2)
    expect(resolvePeriod('all', { from: '', to: '' }, today)).toEqual({ from: '2000-01-01', to: '2099-12-31', label: 'All time' })
    expect(resolvePeriod('custom', { from: '2026-06-01', to: '2026-06-30' }, today).from).toBe('2026-06-01')
    expect(resolvePeriod('custom', { from: '', to: '' }, today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(resolvePeriod('this_month', { from: '', to: '' }, today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
  })
  it('names every choice', () => {
    expect(PERIOD_CHOICES.map(choiceLabel)).toContain('All time')
  })
})
