import { describe, expect, it } from 'vitest'
import { matchesDate, monthsOf, weekOf } from './list-filters'

describe('Shoots list date choices', () => {
  const today = '2026-10-01' // a Thursday

  it('takes this week as Monday to Sunday', () => {
    expect(weekOf(today)).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(matchesDate('2026-09-28', 'this_week', today)).toBe(true)
    expect(matchesDate('2026-10-05', 'this_week', today)).toBe(false)
  })

  it('finds unscheduled shoots and shoots in a month', () => {
    expect(matchesDate(null, 'unscheduled', today)).toBe(true)
    expect(matchesDate('2026-10-01', 'unscheduled', today)).toBe(false)
    expect(matchesDate('2026-11-14', 'month:2026-11', today)).toBe(true)
    expect(matchesDate(null, 'month:2026-11', today)).toBe(false)
  })

  it('lists the months that have shoots, newest first', () => {
    expect(monthsOf(['2026-11-14', null, '2026-10-02', '2026-11-01']).map((m) => m.value)).toEqual(['month:2026-11', 'month:2026-10'])
  })
})
