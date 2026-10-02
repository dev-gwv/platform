import { describe, expect, it } from 'vitest'
import { bySection, sectionOf, waitingFor, workSentence } from './my-work-sections'

const today = '2026-10-02'
const row = (status: string, estimated_date: string | null, changes_requested = false) => ({ status, estimated_date, changes_requested })

describe('my work sections', () => {
  it('puts each edit where it belongs', () => {
    expect(sectionOf(row('in_progress', '2026-10-01', true), today)).toBe('changes')
    expect(sectionOf(row('in_progress', '2026-10-01'), today)).toBe('late')
    expect(sectionOf(row('in_progress', '2026-10-08'), today)).toBe('week')
    expect(sectionOf(row('pending', '2026-10-09'), today)).toBe('later')
    expect(sectionOf(row('pending', null), today)).toBe('later')
    expect(sectionOf(row('review', '2026-09-01'), today)).toBe('review')
    expect(sectionOf(row('completed', '2026-09-01'), today)).toBe('done')
  })

  it('orders the sections: sent back, late, this week, later, review, done', () => {
    const groups = bySection(
      [row('completed', null), row('review', null), row('pending', null), row('in_progress', '2026-10-03'), row('in_progress', '2026-09-30'), row('in_progress', null, true)],
      today,
    )
    expect(groups.map((g) => g.section)).toEqual(['changes', 'late', 'week', 'later', 'review', 'done'])
  })

  it('says it in one line', () => {
    expect(workSentence([row('in_progress', '2026-09-30'), row('pending', null), row('completed', null)], today)).toBe('2 edits · 1 late')
    expect(workSentence([], today)).toBe('Nothing to edit right now.')
  })

  it('names the shoots whose data is not in', () => {
    expect(waitingFor([{ name: 'Haldi', data_ready: false }, { name: 'Wedding', data_ready: true }])).toBe('Waiting for Haldi data')
    expect(waitingFor([{ name: 'Wedding', data_ready: true }])).toBeNull()
    expect(waitingFor([])).toBeNull()
  })
})
