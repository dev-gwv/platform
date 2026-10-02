import { describe, expect, it } from 'vitest'
import type { PlanInstalment } from '@ipc/contracts'
import { instalmentAmounts, planStatus, planDueDate } from './plan'

const pct = (label: string, value: number): PlanInstalment => ({ label, mode: 'percent', value, due_trigger: null })
const MULBERRY = [pct('Advance', 30), pct('Before the wedding', 30), pct('On the day', 30), pct('On delivery', 10)]

describe('instalment amounts', () => {
  it('turns percentages into rupees that add up exactly', () => {
    expect(instalmentAmounts(MULBERRY, 227_000)).toEqual([68_100, 68_100, 68_100, 22_700])
    const odd = instalmentAmounts([pct('A', 33.33), pct('B', 33.33), pct('C', 33.34)], 100_001)
    expect(odd.reduce((a, b) => a + b, 0)).toBe(100_001)
  })

  it('keeps fixed amounts as typed', () => {
    expect(instalmentAmounts([{ label: 'Token', mode: 'amount', value: 11_000, due_trigger: null }, pct('Rest', 50)], 200_000)).toEqual([11_000, 100_000])
  })
})

describe('plan status', () => {
  it('marks the advance received and the next part due', () => {
    const rows = planStatus({ instalments: MULBERRY, total: 200_000, received: 60_000, invoiced: 60_000 })
    expect(rows.map((r) => r.state)).toEqual(['received', 'due', 'upcoming', 'upcoming'])
    expect(rows[1]).toMatchObject({ amount: 60_000, received: 0, remaining: 60_000 })
  })

  it('counts part payments against the first unpaid part', () => {
    const rows = planStatus({ instalments: MULBERRY, total: 200_000, received: 90_000, invoiced: 0 })
    expect(rows.map((r) => r.state)).toEqual(['received', 'part', 'upcoming', 'upcoming'])
    expect(rows[1]).toMatchObject({ received: 30_000, remaining: 30_000 })
  })

  it('shows an invoiced part that is not yet paid', () => {
    const rows = planStatus({ instalments: MULBERRY, total: 200_000, received: 60_000, invoiced: 120_000 })
    expect(rows.map((r) => r.state)).toEqual(['received', 'invoiced', 'upcoming', 'upcoming'])
  })

  it('never goes past received when more came in than the plan', () => {
    const rows = planStatus({ instalments: MULBERRY, total: 200_000, received: 250_000, invoiced: 0 })
    expect(rows.every((r) => r.state === 'received')).toBe(true)
    expect(rows.reduce((n, r) => n + r.received, 0)).toBe(200_000)
  })

  it('is empty with no plan', () => {
    expect(planStatus({ instalments: [], total: 100_000, received: 0, invoiced: 0 })).toEqual([])
  })
})

describe('planDueDate', () => {
  const shoots = [
    { name: 'Haldi', shoot_date: '2026-11-10' },
    { name: 'Wedding', shoot_date: '2026-11-12' },
    { name: 'Pre-wedding', shoot_date: '2026-10-20' },
    { name: 'Reception', shoot_date: null },
  ]
  const at = (t: string | null) => planDueDate(t, { shoots, agreedOn: '2026-10-01T10:00:00Z' })
  it('places a part before, or on, the shoot it names', () => {
    expect(at('Before the wedding')).toEqual({ date: '2026-11-05', why: '7 days before Wedding' })
    expect(at('On the haldi')).toEqual({ date: '2026-11-10', why: 'on Haldi' })
    expect(at('Wedding day')?.date).toBe('2026-11-12')
    expect(at('Before the pre-wedding shoot')?.date).toBe('2026-10-13')
  })
  it('puts the advance on the day the client agreed', () => {
    expect(at('On booking')).toEqual({ date: '2026-10-01', why: 'on booking' })
    expect(planDueDate('Advance', { shoots })).toBeNull()
  })
  it('leaves what it cannot place undated', () => {
    expect(at('On delivery')).toBeNull()
    expect(at('After the reception')).toBeNull()
    expect(at('On the reception')).toBeNull()
    expect(at(null)).toBeNull()
  })
})
