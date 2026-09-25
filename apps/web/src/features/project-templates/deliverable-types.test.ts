import { describe, expect, it } from 'vitest'
import { daysText, parseDays } from './deliverable-types'

describe('parseDays', () => {
  it('reads a blank box as not set, and zero as zero', () => {
    expect(parseDays('')).toEqual({ ok: true, value: null })
    expect(parseDays('   ')).toEqual({ ok: true, value: null })
    expect(parseDays('0')).toEqual({ ok: true, value: 0 })
    expect(parseDays(' 045 ')).toEqual({ ok: true, value: 45 })
  })

  it('says what is wrong instead of saving it', () => {
    expect(parseDays('4.5')).toEqual({ ok: false, message: 'Type a number of days, like 30.' })
    expect(parseDays('-3')).toMatchObject({ ok: false })
    expect(parseDays('ten')).toMatchObject({ ok: false })
    expect(parseDays('365')).toEqual({ ok: true, value: 365 })
    expect(parseDays('366')).toEqual({ ok: false, message: 'Up to 365 days.' })
  })
})

describe('daysText', () => {
  it('shows a stored count, and nothing for one not set', () => {
    expect(daysText(null)).toBe('')
    expect(daysText(0)).toBe('0')
    expect(daysText(90)).toBe('90')
  })
})
