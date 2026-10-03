import { describe, expect, it } from 'vitest'
import { addCardLabels, cardsLine, cleanCardLabel } from './cards'

describe('card labels', () => {
  it('cleans what is typed', () => {
    expect(cleanCardLabel('  sd-04 ')).toBe('SD-04')
  })

  it('adds several at once, each once', () => {
    expect(addCardLabels(['SD-01'], 'sd-01, SD-02,\nsd-03')).toEqual(['SD-01', 'SD-02', 'SD-03'])
    expect(addCardLabels([], '  ,  ')).toEqual([])
  })

  it('says the count and the names', () => {
    expect(cardsLine(0, ['SD-01', 'SD-02'])).toBe('2 cards · SD-01, SD-02')
    expect(cardsLine(3, ['SD-01'])).toBe('3 cards · SD-01')
    expect(cardsLine(1)).toBe('1 card')
    expect(cardsLine(0)).toBeNull()
  })
})
