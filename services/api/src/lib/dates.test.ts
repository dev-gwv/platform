import { describe, expect, it } from 'vitest'
import { todayInIndia } from './dates'

describe('todayInIndia', () => {
  it('is already tomorrow in India after 18:30 UTC', () => {
    expect(todayInIndia(new Date('2026-10-02T18:30:00Z'))).toBe('2026-10-03')
  })
  it('is the same day before 18:30 UTC', () => {
    expect(todayInIndia(new Date('2026-10-02T18:29:00Z'))).toBe('2026-10-02')
  })
})
