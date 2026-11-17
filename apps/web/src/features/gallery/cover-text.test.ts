import { describe, expect, it } from 'vitest'
import { coverSentence, coverShare } from './cover-text'

const until = '2026-12-17T06:30:00.000Z'

describe('the Drive gallery photos line (0307)', () => {
  it('says how many are kept, of how many, on which plan and until when', () => {
    expect(coverSentence({ plan: 'Diamond Pro', until, photos: 25000, used: 4200, active: true })).toBe('4,200 of 25,000 photos kept · included in your Diamond Pro plan until 17 Dec 2026.')
    expect(coverSentence({ plan: 'Trial', until, photos: 3000, used: 0, active: true })).toContain('included in your trial')
  })

  it('warns when nearly full, says what to do when full, and when the plan ended', () => {
    expect(coverSentence({ plan: 'Pro', until, photos: 25000, used: 23000, active: true })).toContain('Only 2,000 left.')
    expect(coverSentence({ plan: 'Pro', until, photos: 25000, used: 25000, active: true })).toContain('Delete an old gallery to make room, or ask us for more.')
    expect(coverSentence({ plan: 'Pro', until, photos: 25000, used: 10, active: false })).toContain('Your plan ended on 17 Dec 2026')
    expect(coverShare({ photos: 0, used: 0 })).toBe(1)
  })
})
