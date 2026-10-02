import { describe, expect, it } from 'vitest'
import { greeting, todayLine } from './greeting'

// 06:30 UTC is noon in India.
const at = (utc: string) => new Date(`2026-10-02T${utc}:00Z`)

describe('greeting', () => {
  it('goes by India time', () => {
    expect(greeting('Asha Rao', at('06:29'))).toBe('Good morning, Asha.')
    expect(greeting('Asha Rao', at('06:30'))).toBe('Good afternoon, Asha.')
    expect(greeting('Asha', at('11:29'))).toBe('Good afternoon, Asha.')
    expect(greeting('Asha', at('11:30'))).toBe('Good evening, Asha.')
  })
  it('has no stray comma without a name', () => {
    expect(greeting('', at('03:00'))).toBe('Good morning.')
    expect(greeting(null, at('03:00'))).toBe('Good morning.')
  })
})

describe('todayLine', () => {
  it('is India\'s date, upper case', () => {
    expect(todayLine(at('06:00'))).toBe('FRIDAY, 2 OCTOBER')
    // 19:00 UTC is already Saturday in India.
    expect(todayLine(at('19:00'))).toBe('SATURDAY, 3 OCTOBER')
  })
})
