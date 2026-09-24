import { describe, expect, it } from 'vitest'
import { deliverableKind } from './deliverable-kind'
import { relativeDue } from './deliverable-stage'

describe('deliverableKind', () => {
  it.each([
    ['Wedding album (40 sheets)', 'album'],
    ['Photo Album', 'album'],
    ['Teaser', 'reel'],
    ['Teaser film', 'reel'],
    ['Instagram Reels Pack', 'reel'],
    ['Reel / Short Video', 'reel'],
    ['Full Wedding Film', 'film'],
    ['Highlight film', 'film'],
    ['Cinematic video', 'film'],
    ['Edited Photos', 'photos'],
    ['Retouched selects', 'photos'],
    ['Canvas prints', 'print'],
    ['Raw footage archive', 'data'],
    ['Data Sorting', 'data'],
    ['Something else entirely', 'other'],
  ])('%s is %s', (title, kind) => {
    expect(deliverableKind(title)).toBe(kind)
  })
})

describe('relativeDue', () => {
  const today = '2026-09-24'
  it.each([
    [{ status: 'pending', estimated_date: '2026-09-24' }, 'Due today'],
    [{ status: 'pending', estimated_date: '2026-09-25' }, 'Due tomorrow'],
    [{ status: 'in_progress', estimated_date: '2026-10-06' }, 'Due in 12 days'],
    [{ status: 'in_progress', estimated_date: '2026-09-21' }, '3 days late'],
    [{ status: 'review', estimated_date: '2026-09-23' }, '1 day late'],
    [{ status: 'completed', estimated_date: '2026-09-01', delivered_at: '2026-09-10T08:00:00Z' }, 'Delivered 10 Sept'],
    [{ status: 'pending', estimated_date: null }, null],
    [{ status: 'cancelled', estimated_date: '2026-09-01' }, null],
  ])('%j reads %s', (d, want) => {
    expect(relativeDue(d, today)).toBe(want)
  })
})
