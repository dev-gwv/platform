import { describe, expect, it } from 'vitest'
import { DEFAULT_SPEED_INDEX, SPEEDS, pxPerSecond, spokenText, stepSpeed } from './teleprompter'

describe('teleprompter', () => {
  it('scrolls the script past in its spoken time', () => {
    expect(pxPerSecond(1200, 60, 1)).toBe(20)
    expect(pxPerSecond(1200, 60, 1.5)).toBe(30)
    expect(pxPerSecond(0, 60, 1)).toBe(0)
    expect(pxPerSecond(1200, 0, 1)).toBe(0)
  })

  it('steps the speed inside its list', () => {
    expect(SPEEDS[DEFAULT_SPEED_INDEX]).toBe(1)
    expect(stepSpeed(0, -1)).toBe(0)
    expect(stepSpeed(SPEEDS.length - 1, 1)).toBe(SPEEDS.length - 1)
    expect(stepSpeed(2, 1)).toBe(3)
    expect(SPEEDS[3]! - SPEEDS[2]!).toBeGreaterThanOrEqual(0.25)
  })

  it('reads the hook first, then each part', () => {
    expect(spokenText({ hook: ' Hi ', parts: [{ text: 'one' }, { text: ' ' }, { text: 'two' }] })).toEqual(['Hi', 'one', 'two'])
  })
})
