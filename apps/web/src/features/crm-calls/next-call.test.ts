import { describe, expect, it } from 'vitest'
import { nextCallAt, suggestedNext } from './next-call'

describe('nextCallAt', () => {
  const at = (s: string) => new Date(s)
  it('an hour, this evening, tomorrow at 11, three days', () => {
    const now = at('2026-10-05T10:00:00')
    expect(new Date(nextCallAt('hour', now)!).getHours()).toBe(11)
    expect(new Date(nextCallAt('evening', now)!).getHours()).toBe(18)
    const t = new Date(nextCallAt('tomorrow', now)!)
    expect([t.getDate(), t.getHours()]).toEqual([6, 11])
    expect(new Date(nextCallAt('three_days', now)!).getDate()).toBe(8)
    expect(nextCallAt('none', now)).toBeNull()
  })
  it('"this evening" after six means tomorrow evening', () => {
    const e = new Date(nextCallAt('evening', at('2026-10-05T19:30:00'))!)
    expect([e.getDate(), e.getHours()]).toEqual([6, 18])
  })
  it('suggests a retry after a miss and nothing after a wrong number', () => {
    expect(suggestedNext('no_answer')).toBe('hour')
    expect(suggestedNext('callback')).toBe('evening')
    expect(suggestedNext('wrong_number')).toBe('none')
    expect(suggestedNext('answered')).toBe('three_days')
  })
})
