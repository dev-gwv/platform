import { describe, expect, it } from 'vitest'
import { daysLeft, daysLeftText, todayInIndia } from './days-left'

describe('days left', () => {
  it('says it the way a person would', () => {
    expect(daysLeftText(0)).toBe('Due today')
    expect(daysLeftText(1)).toBe('Due tomorrow')
    expect(daysLeftText(4)).toBe('4 days left')
    expect(daysLeftText(-1)).toBe('1 day late')
    expect(daysLeftText(-3)).toBe('3 days late')
  })

  it('is red once late, amber within two days, calm after', () => {
    expect(daysLeft('2026-10-01', '2026-10-02')?.tone).toBe('late')
    expect(daysLeft('2026-10-04', '2026-10-02')).toEqual({ days: 2, text: '2 days left', tone: 'soon' })
    expect(daysLeft('2026-10-09', '2026-10-02')?.tone).toBe('calm')
    expect(daysLeft(null)).toBeNull()
  })

  it('takes the day in India: 11:30 pm UTC is already tomorrow there', () => {
    expect(todayInIndia(new Date('2026-10-02T19:00:00Z'))).toBe('2026-10-03')
  })
})
