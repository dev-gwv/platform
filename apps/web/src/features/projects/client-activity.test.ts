import { describe, expect, it } from 'vitest'
import { clientActivityLines, whenShort } from './client-activity'

const view = (kind: 'quotation' | 'invoice' | 'terms', at: string, views = 1) => ({ kind, subject_id: 'x', last_viewed_at: at, views })

describe('clientActivityLines', () => {
  it('says nothing when the client has done nothing', () => {
    expect(clientActivityLines(undefined)).toEqual([])
    expect(clientActivityLines({ views: [], accepted_at: null, accepted_by: null, declined_at: null })).toEqual([])
  })

  it('reads the opens and the acceptance, newest first, three at most', () => {
    const lines = clientActivityLines({
      views: [view('quotation', '2026-10-02T13:10:00Z', 3), view('invoice', '2026-10-01T05:00:00Z'), view('terms', '2026-09-30T05:00:00Z')],
      accepted_at: '2026-10-02T14:00:00Z',
      accepted_by: 'Priya',
      declined_at: null,
    })
    expect(lines).toEqual([
      'Accepted by Priya · 2 Oct, 7:30 pm',
      'Quotation opened · 2 Oct, 6:40 pm (3 times)',
      'Invoice opened · 1 Oct, 10:30 am',
    ])
  })

  it('reads a decline', () => {
    expect(clientActivityLines({ views: [], accepted_at: null, accepted_by: null, declined_at: '2026-10-02T13:10:00Z' })).toEqual([
      'Quotation declined · 2 Oct, 6:40 pm',
    ])
  })

  it('dates in India', () => {
    expect(whenShort('2026-10-02T19:00:00Z')).toBe('3 Oct, 12:30 am')
  })
})
