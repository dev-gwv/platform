import { describe, expect, it } from 'vitest'
import { defaultPeriod, from12h, niceTime, parseTime, parseTypedTime, to12h, toHHMM } from './time-format'

describe('parseTime', () => {
  it('reads the browser and Postgres shapes', () => {
    expect(parseTime('15:05')).toEqual({ h: 15, m: 5 })
    expect(parseTime('15:05:00')).toEqual({ h: 15, m: 5 })
    expect(parseTime('09:30:15.5')).toEqual({ h: 9, m: 30 })
    expect(parseTime('9:05')).toEqual({ h: 9, m: 5 })
  })
  it('rejects what is not a clock time', () => {
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('12:60')).toBeNull()
    expect(parseTime('')).toBeNull()
    expect(parseTime(null)).toBeNull()
    expect(parseTime('noon')).toBeNull()
  })
})

describe('niceTime', () => {
  it('says it the way a person does', () => {
    expect(niceTime('15:12')).toBe('3:12 PM')
    expect(niceTime('00:05')).toBe('12:05 AM')
    expect(niceTime('12:00:00')).toBe('12:00 PM')
    expect(niceTime('09:00')).toBe('9:00 AM')
  })
  it('leaves blanks and junk alone', () => {
    expect(niceTime('')).toBe('')
    expect(niceTime(undefined)).toBe('')
    expect(niceTime('soon')).toBe('soon')
  })
})

describe('12-hour round trips', () => {
  it('maps midnight and noon both ways', () => {
    expect(to12h({ h: 0, m: 0 })).toEqual({ hour12: 12, minute: 0, period: 'AM' })
    expect(to12h({ h: 12, m: 30 })).toEqual({ hour12: 12, minute: 30, period: 'PM' })
    expect(from12h(12, 0, 'AM')).toEqual({ h: 0, m: 0 })
    expect(from12h(12, 0, 'PM')).toEqual({ h: 12, m: 0 })
    expect(toHHMM(from12h(3, 5, 'PM'))).toBe('15:05')
  })
  it('leans a bare hour toward the shoot day', () => {
    expect(defaultPeriod(6)).toBe('AM')
    expect(defaultPeriod(11)).toBe('AM')
    expect(defaultPeriod(12)).toBe('PM')
    expect(defaultPeriod(4)).toBe('PM')
  })
})

describe('parseTypedTime', () => {
  it.each([
    ['3:15 pm', '15:15'],
    ['3.15pm', '15:15'],
    ['03:15PM', '15:15'],
    ['3 pm', '15:00'],
    ['3pm', '15:00'],
    ['12 am', '00:00'],
    ['12pm', '12:00'],
    ['15:15', '15:15'],
    ['1515', '15:15'],
    ['930', '09:30'],
    ['3', '15:00'],
    ['7', '07:00'],
    ['15', '15:00'],
    ['0', '00:00'],
  ])('%s → %s', (typed, expected) => {
    expect(parseTypedTime(typed)).toBe(expected)
  })
  it.each(['13 pm', '25:00', '9:75', 'hello', '', '3:'])('rejects %s', (typed) => {
    expect(parseTypedTime(typed)).toBeNull()
  })
})
