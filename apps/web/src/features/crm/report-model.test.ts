import { describe, expect, it } from 'vitest'
import { bucketSeries, followUpSentence, qualityRows } from './report-model'

const h = (o: Partial<Record<'overdue' | 'due_today' | 'due_tomorrow' | 'upcoming_7d' | 'no_follow_up', number>>) => ({
  overdue: 0,
  due_today: 0,
  due_tomorrow: 0,
  upcoming_7d: 0,
  no_follow_up: 0,
  ...o,
})

describe('followUpSentence', () => {
  it('says what is late, what is today, what is ahead and what is missing', () => {
    expect(followUpSentence(h({ overdue: 2, due_today: 3, due_tomorrow: 1, upcoming_7d: 4, no_follow_up: 1 }))).toBe(
      '2 follow-ups overdue and 3 due today. 5 more in the next week. 1 open lead has no follow-up set.',
    )
  })
  it('is calm when nothing is due', () => {
    expect(followUpSentence(h({}))).toBe('Nothing overdue or due today.')
    expect(followUpSentence(h({ overdue: 1 }))).toBe('1 follow-up overdue.')
  })
})

describe('qualityRows', () => {
  it('puts hot, warm, cold first, the studio’s words next and "not set" last', () => {
    expect(qualityRows({ unset: 5, cold: 1, vip: 2, hot: 3, warm: 0 }).map((r) => r.key)).toEqual(['hot', 'cold', 'vip', 'unset'])
  })
})

describe('bucketSeries', () => {
  it('fills every day in a short range, quiet days included', () => {
    const out = bucketSeries([{ day: '2026-09-02', count: 4 }], ['count'], '2026-09-01', '2026-09-03')
    expect(out.map((b) => [b.key, b.count])).toEqual([
      ['2026-09-01', 0],
      ['2026-09-02', 4],
      ['2026-09-03', 0],
    ])
  })
  it('folds a quarter into Monday weeks and a year into months', () => {
    const weeks = bucketSeries(
      [
        { day: '2026-09-01', won: 1, lost: 0 },
        { day: '2026-09-06', won: 2, lost: 1 },
        { day: '2026-09-07', won: 0, lost: 1 },
      ],
      ['won', 'lost'],
      '2026-07-01',
      '2026-09-28',
    )
    const w = weeks.find((b) => b.key === '2026-08-31')!
    expect([w.won, w.lost]).toEqual([3, 1])
    expect(weeks.find((b) => b.key === '2026-09-07')!.lost).toBe(1)
    expect(w.label).toMatch(/^Week of 31 Aug/)

    const months = bucketSeries([{ day: '2026-03-15', count: 2 }], ['count'], '2025-10-01', '2026-09-30')
    expect(months).toHaveLength(12)
    expect(months.find((b) => b.key === '2026-03')!.count).toBe(2)
  })
})
