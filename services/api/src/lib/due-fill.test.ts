import { describe, expect, it } from 'vitest'
import { projectDueDates } from './due-fill'

describe('projectDueDates', () => {
  const shoots = [
    { name: 'Haldi', shoot_date: '2026-11-20' },
    { name: 'Wedding Day', shoot_date: '2026-11-21' },
  ]

  it('dates each deliverable from the studio’s own type, in the order given', () => {
    const out = projectDueDates(
      [
        { id: 'a', title: 'Teaser' },
        { id: 'b', title: 'Album' },
      ],
      shoots,
      [
        { title: 'Teaser', due_days: 7, due_basis: 'after_wedding_day', work_days: 2 },
        { title: 'Album', due_days: 30, due_basis: 'after_last_shoot', work_days: 10 },
      ],
      '2026-10-09',
    )
    expect(out).toEqual([
      { id: 'a', due: '2026-11-28' },
      { id: 'b', due: '2026-12-21' },
    ])
  })

  it('leaves out a deliverable whose anchor is not known yet', () => {
    const out = projectDueDates(
      [
        { id: 'a', title: 'Teaser' },
        { id: 'b', title: 'Brochure' },
      ],
      [{ name: 'Haldi', shoot_date: null }],
      [
        { title: 'Teaser', due_days: 7, due_basis: 'after_wedding_day', work_days: 2 },
        { title: 'Brochure', due_days: 5, due_basis: 'after_project_created', work_days: 1 },
      ],
      '2026-10-09',
    )
    expect(out).toEqual([{ id: 'b', due: '2026-10-14' }])
  })

  it('gives nothing for nothing', () => {
    expect(projectDueDates([], shoots, [], '2026-10-09')).toEqual([])
  })
})
