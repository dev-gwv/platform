import { describe, expect, it } from 'vitest'
import { followUpChip } from './follow-up-chip'

const now = new Date('2026-10-02T06:00:00Z')

describe('followUpChip', () => {
  it('says when the next call is, in India time', () => {
    expect(followUpChip('2026-10-03T05:30:00Z', true, now)).toEqual({ text: 'Follow up 3 Oct, 11:00 am', late: false, missing: false })
  })
  it('says when it was due once it has passed', () => {
    expect(followUpChip('2026-10-02T04:30:00Z', true, now)?.text).toBe('Follow-up was due 2 Oct, 10:00 am')
  })
  it('asks for one on an open lead, and says nothing on a closed one', () => {
    expect(followUpChip(null, true, now)).toEqual({ text: 'No follow-up yet', late: false, missing: true })
    expect(followUpChip(null, false, now)).toBeNull()
  })
})
