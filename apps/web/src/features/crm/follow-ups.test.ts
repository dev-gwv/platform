import { describe, expect, it } from 'vitest'
import { dueWords, followUpBucket, mergeFollowUps, presetAt, shouldRemind } from './follow-ups'

// Sun 28 Sep 2026, 16:00 local.
const NOW = new Date(2026, 8, 28, 16, 0)

describe('followUpBucket', () => {
  it('sorts by the viewer’s day, not 24-hour windows', () => {
    expect(followUpBucket(new Date(2026, 8, 28, 15, 59), NOW)).toBe('overdue')
    expect(followUpBucket(new Date(2026, 8, 28, 23, 59), NOW)).toBe('today')
    expect(followUpBucket(new Date(2026, 8, 29, 0, 0), NOW)).toBe('tomorrow')
    expect(followUpBucket(new Date(2026, 9, 4, 23, 0), NOW)).toBe('week')
    expect(followUpBucket(new Date(2026, 9, 5, 0, 0), NOW)).toBe('later')
  })
})

describe('presetAt', () => {
  it('puts morning follow-ups at 11', () => {
    expect(presetAt('tomorrow', NOW)).toEqual(new Date(2026, 8, 29, 11, 0))
    expect(presetAt('three_days', NOW)).toEqual(new Date(2026, 9, 1, 11, 0))
    expect(presetAt('next_week', NOW)).toEqual(new Date(2026, 9, 5, 11, 0))
  })

  it('makes "today" two hours out, or 6 pm, and never after 9 pm', () => {
    expect(presetAt('today', NOW)).toEqual(new Date(2026, 8, 28, 18, 0))
    expect(presetAt('today', new Date(2026, 8, 28, 17, 30))).toEqual(new Date(2026, 8, 28, 19, 30))
    expect(presetAt('today', new Date(2026, 8, 28, 20, 0))).toEqual(new Date(2026, 8, 28, 21, 0))
  })
})

describe('dueWords', () => {
  it('says late in days once a day has passed', () => {
    expect(dueWords(new Date(2026, 8, 26, 11, 0), NOW)).toBe('2 days late')
    expect(dueWords(new Date(2026, 8, 29, 11, 0), NOW)).toMatch(/^Tomorrow/)
  })
})

describe('shouldRemind', () => {
  it('fires in the ten minutes before and the first minute after', () => {
    expect(shouldRemind(new Date(NOW.getTime() + 11 * 60_000), NOW)).toBe(false)
    expect(shouldRemind(new Date(NOW.getTime() + 9 * 60_000), NOW)).toBe(true)
    expect(shouldRemind(new Date(NOW.getTime() - 30_000), NOW)).toBe(true)
    expect(shouldRemind(new Date(NOW.getTime() - 2 * 60_000), NOW)).toBe(false)
  })
})

describe('mergeFollowUps', () => {
  const now = new Date('2026-10-10T06:00:00Z')
  const t = (id: string, lead: string | null, due: string | null) => ({ id, lead_id: lead, due_at: due })

  it('puts a lead in the queue on its row, once, with its earliest follow-up', () => {
    const r = mergeFollowUps(['a'], [t('2', 'a', '2026-10-10T09:00:00Z'), t('1', 'a', '2026-10-09T09:00:00Z')], now)
    expect(r.onRow.get('a')?.id).toBe('1')
    expect(r.after).toEqual([])
  })

  it('lists only the follow-ups whose lead is not in the queue, one per lead, soonest first', () => {
    const r = mergeFollowUps(
      ['a'],
      [t('3', 'c', '2026-10-13T09:00:00Z'), t('2', 'b', '2026-10-11T09:00:00Z'), t('4', 'b', '2026-10-12T09:00:00Z')],
      now,
    )
    expect(r.after.map((x) => x.id)).toEqual(['2', '3'])
  })

  it('leaves out follow-ups with no lead, no date, or past the week', () => {
    const r = mergeFollowUps([], [t('1', null, '2026-10-10T09:00:00Z'), t('2', 'b', null), t('3', 'c', '2026-11-30T09:00:00Z')], now)
    expect(r.after).toEqual([])
  })
})
