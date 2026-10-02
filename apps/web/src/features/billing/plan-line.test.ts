import { describe, expect, it } from 'vitest'
import { planLine } from './plan-line'

describe('planLine', () => {
  it('names the day it runs until', () => {
    expect(planLine(6, '2026-10-08T18:29:59Z')).toBe('6 days left · until 8 Oct')
    expect(planLine(1, '2026-10-03T18:00:00Z')).toBe('1 day left · until 3 Oct')
  })
  it('says the last day plainly', () => {
    expect(planLine(0, '2026-10-02T18:00:00Z')).toBe('Last day today')
  })
  it('says when it ended', () => {
    expect(planLine(-2, '2026-09-30T10:00:00Z')).toBe('Ended 30 Sept · renew to keep going')
    expect(planLine(-2, null)).toBe('Ended · renew to keep going')
  })
  it('falls back without numbers', () => {
    expect(planLine(null, null)).toBe('See plans')
    expect(planLine(9, null)).toBe('9 days left')
  })
})
