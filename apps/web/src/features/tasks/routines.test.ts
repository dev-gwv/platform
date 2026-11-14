import { describe, expect, it } from 'vitest'
import { clockText, daysText, repeatLine, todayLine } from './routines'

describe('daily task words', () => {
  it('names the days', () => {
    expect(daysText({ repeat: 'days', weekdays: [1, 2, 3, 4, 5, 6, 7], month_day: null })).toBe('Every day')
    expect(daysText({ repeat: 'days', weekdays: [6, 1, 2, 3, 4, 5], month_day: null })).toBe('Mon–Sat')
    expect(daysText({ repeat: 'days', weekdays: [1, 3, 5], month_day: null })).toBe('Mon, Wed, Fri')
    expect(daysText({ repeat: 'monthly', weekdays: [], month_day: 1 })).toBe('On the 1st of each month')
    expect(daysText({ repeat: 'monthly', weekdays: [], month_day: 22 })).toBe('On the 22nd of each month')
    expect(daysText({ repeat: 'monthly', weekdays: [], month_day: 13 })).toBe('On the 13th of each month')
  })
  it('says the time plainly', () => {
    expect(clockText('11:00')).toBe('11 am')
    expect(clockText('16:30')).toBe('4:30 pm')
    expect(clockText('00:05')).toBe('12:05 am')
    expect(clockText('12:00')).toBe('12 pm')
    expect(repeatLine({ repeat: 'days', weekdays: [1, 2, 3, 4, 5, 6, 7], month_day: null, due_time: null })).toBe('Every day · by the end of the day')
  })
  it('counts today', () => {
    const p = (today: 'done' | 'open' | 'late' | 'none') => ({ user_id: 'u', name: 'A', today, task_id: null, done_7: 0, missed_7: 0 })
    expect(todayLine({ paused: false, people: [p('done'), p('late'), p('open')] })).toBe('1 of 3 done today · 1 late')
    expect(todayLine({ paused: false, people: [p('none')] })).toBe('Not due today')
    expect(todayLine({ paused: true, people: [p('done')] })).toBe('Paused')
  })
})
