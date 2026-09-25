import { describe, expect, it } from 'vitest'
import type { BoardDeliverable, DeliverableStage } from '@ipc/contracts'
import { applyFilters, focusCounts, laneOf, lanesFor, personLoad, sortInLane } from './board-model'

const st = (code: string, label: string, stage: DeliverableStage['stage'], sort: number, color = 'slate', team = true): DeliverableStage => ({
  id: `00000000-0000-4000-8000-${String(sort).padStart(12, '0')}`,
  code,
  label,
  stage,
  color,
  team_allowed: team,
  sort_order: sort,
})

const DEFAULTS = [
  st('changes_requested', 'Changes requested', 'in_progress', 10, 'rose'),
  st('with_manager', 'With manager', 'review', 10, 'violet'),
  st('approved', 'Approved', 'review', 20, 'teal', false),
  st('with_client', 'With client', 'review', 30, 'amber'),
  st('client_approved', 'Client approved', 'review', 40, 'green', false),
]

let n = 0
const d = (over: Partial<BoardDeliverable>): BoardDeliverable => ({
  id: `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`,
  project_id: '00000000-0000-4000-a000-000000000001',
  project_name: 'Sharma wedding',
  title: `Item ${n}`,
  status: 'pending',
  visibility_scope: 'client',
  notes_count: 0,
  voice_count: 0,
  ...over,
})

const TODAY = '2026-09-25'
const PRIYA = '00000000-0000-4000-b000-000000000001'
const AMAN = '00000000-0000-4000-b000-000000000002'

describe('lanes', () => {
  it("follow the studio's stages, in its order, with Changes requested and no bare Review", () => {
    expect(lanesFor(DEFAULTS).map((l) => l.label)).toEqual([
      'To do',
      'Editing',
      'Changes requested',
      'With manager',
      'Approved',
      'With client',
      'Client approved',
      'Delivered',
    ])
  })

  it('pick up a stage the studio renamed or added', () => {
    const renamed = [...DEFAULTS.filter((s) => s.code !== 'with_client'), st('with_client', 'Shared with couple', 'review', 30, 'amber'), st('colour_grading', 'Colour grading', 'in_progress', 20, 'blue')]
    const labels = lanesFor(renamed).map((l) => l.label)
    expect(labels).toContain('Shared with couple')
    expect(labels.indexOf('Colour grading')).toBe(labels.indexOf('Changes requested') + 1)
  })

  it('show a plain Review lane only when the studio has no review stages', () => {
    expect(lanesFor([]).map((l) => l.label)).toEqual(['To do', 'Editing', 'Review', 'Delivered'])
  })

  it('put a card on a removed stage in its step, and dropped work nowhere', () => {
    const lanes = lanesFor(DEFAULTS)
    expect(laneOf({ status: 'in_progress', custom_status_code: 'gone' }, lanes)?.label).toBe('Editing')
    expect(laneOf({ status: 'review', custom_status_code: null }, lanes)?.label).toBe('With manager')
    expect(laneOf({ status: 'review', custom_status_code: 'with_client' }, lanes)?.label).toBe('With client')
    expect(laneOf({ status: 'cancelled', custom_status_code: null }, lanes)).toBeNull()
  })
})

describe('figures and filters', () => {
  const items = [
    d({ status: 'in_progress', estimated_date: '2026-09-20', assignee_id: PRIYA }),
    d({ status: 'pending', estimated_date: TODAY }),
    d({ status: 'review', custom_status_code: 'with_client', estimated_date: '2026-09-01', assignee_id: AMAN }),
    d({ status: 'completed', estimated_date: '2026-09-01', assignee_id: PRIYA, delivered_at: '2026-09-24T10:00:00Z' }),
    d({ status: 'in_progress', assignee_id: AMAN, project_id: '00000000-0000-4000-a000-000000000002', project_name: 'Kapoor pre-wedding' }),
  ]

  it('count late, due today, waiting on review and unassigned; delivered work is never late', () => {
    expect(focusCounts(items, TODAY)).toEqual({ open: 4, late: 2, today: 1, review: 1, unassigned: 1 })
  })

  it('compose project, person, focus and search', () => {
    expect(applyFilters(items, { person: AMAN }, TODAY)).toHaveLength(2)
    expect(applyFilters(items, { person: AMAN, focus: 'late' }, TODAY)).toHaveLength(1)
    expect(applyFilters(items, { person: 'none' }, TODAY)).toHaveLength(1)
    expect(applyFilters(items, { project: '00000000-0000-4000-a000-000000000002' }, TODAY)).toHaveLength(1)
    expect(applyFilters(items, { q: 'kapoor' }, TODAY)).toHaveLength(1)
  })
})

describe('what a person is carrying', () => {
  it('counts open, late and due this week, soonest first', () => {
    const items = [
      d({ status: 'in_progress', estimated_date: '2026-10-10', assignee_id: PRIYA, title: 'Film' }),
      d({ status: 'in_progress', estimated_date: '2026-09-20', assignee_id: PRIYA, title: 'Reel' }),
      d({ status: 'review', estimated_date: '2026-10-01', assignee_id: PRIYA, title: 'Album' }),
      d({ status: 'in_progress', estimated_date: TODAY, assignee_id: PRIYA, title: 'Teaser' }),
      d({ status: 'completed', estimated_date: TODAY, assignee_id: PRIYA, title: 'Done' }),
      d({ status: 'in_progress', estimated_date: TODAY, assignee_id: AMAN, title: 'Not hers' }),
    ]
    const load = personLoad(items, PRIYA, TODAY)
    expect(load.open.map((x) => x.title)).toEqual(['Reel', 'Teaser', 'Album', 'Film'])
    expect(load.late).toBe(1)
    expect(load.dueThisWeek).toBe(2)
    expect(personLoad(items, null, TODAY).open).toHaveLength(0)
  })

  it('orders delivered work newest first, everything else by due date', () => {
    const a = d({ status: 'completed', delivered_at: '2026-09-20T00:00:00Z' })
    const b = d({ status: 'completed', delivered_at: '2026-09-24T00:00:00Z' })
    expect(sortInLane([a, b], { status: 'completed' })[0]).toBe(b)
    const c = d({ estimated_date: '2026-10-01' })
    const e = d({})
    const f = d({ estimated_date: '2026-09-01' })
    expect(sortInLane([c, e, f], { status: 'pending' })).toEqual([f, c, e])
  })
})
