import { describe, expect, it } from 'vitest'
import {
  completionOf,
  nextActionFor,
  projectHealth,
  scoreOf,
  type ProjectCounters,
} from './tracking'

const TODAY = '2026-09-01'

const counters = (over: Partial<ProjectCounters> = {}): ProjectCounters => ({
  status: 'active',
  tasks_total: 0,
  tasks_done: 0,
  tasks_overdue: 0,
  deliverables_total: 0,
  deliverables_done: 0,
  data_records_total: 0,
  data_records_unverified: 0,
  pending_reviews: 0,
  shoots_total: 1,
  shoots_done: 0,
  next_shoot_date: '2026-09-10',
  last_activity_at: '2026-08-30T10:00:00Z',
  ...over,
})

describe('completionOf', () => {
  it('counts tasks and deliverables together', () => {
    // Every task ticked but nothing delivered is not a finished project.
    expect(completionOf(counters({ tasks_total: 2, tasks_done: 2 }))).toBe(1)
    expect(
      completionOf(counters({ tasks_total: 2, tasks_done: 2, deliverables_total: 2 })),
    ).toBe(0.5)
  })

  it('is zero when there is nothing to count', () => {
    // An empty project has made no progress; it is not complete.
    expect(completionOf(counters())).toBe(0)
  })
})

describe('nextActionFor', () => {
  it('puts custody of the footage above everything else', () => {
    // An overdue edit costs a deadline. A missing card costs the shoot.
    const c = counters({ data_records_unverified: 2, tasks_overdue: 5, pending_reviews: 3 })
    expect(nextActionFor(c, 0.5)).toBe('secure_data')
  })

  it('then chases late work, then work waiting on someone else', () => {
    expect(nextActionFor(counters({ tasks_overdue: 1, pending_reviews: 2 }), 0.5)).toBe('clear_overdue')
    expect(nextActionFor(counters({ pending_reviews: 2 }), 0.5)).toBe('review_submissions')
  })

  it('asks for a shoot date when nothing is scheduled', () => {
    expect(nextActionFor(counters({ shoots_total: 0 }), 0)).toBe('schedule_shoot')
  })

  it('asks for a plan when the shooting is done and nothing is booked against it', () => {
    const c = counters({ shoots_total: 2, shoots_done: 2 })
    expect(nextActionFor(c, 0)).toBe('plan_work')
  })

  it('treats a late deliverable like an overdue task', () => {
    const c = counters({ deliverables_total: 2, deliverables_late: 1 })
    expect(nextActionFor(c, 0.2)).toBe('clear_overdue')
    expect(projectHealth(c, TODAY).flags.overdue).toBe(true)
    expect(scoreOf(c, 0.2, TODAY)).toBeGreaterThan(scoreOf(counters({ deliverables_total: 2 }), 0.2, TODAY))
  })

  it('does not ask for tasks when the deliverables are the plan', () => {
    const c = counters({ shoots_total: 2, shoots_done: 2, deliverables_total: 3 })
    expect(nextActionFor(c, 0)).toBe('keep_going')
  })

  it('says deliver once everything is ticked', () => {
    const c = counters({ tasks_total: 3, tasks_done: 3, deliverables_total: 1, deliverables_done: 1 })
    expect(nextActionFor(c, 1)).toBe('deliver')
  })

  it('has nothing to say about a cancelled or closed project', () => {
    expect(nextActionFor(counters({ status: 'cancelled', tasks_overdue: 4 }), 0.2)).toBe('none')
    expect(nextActionFor(counters({ status: 'completed' }), 1)).toBe('none')
  })
})

describe('scoreOf', () => {
  it('ranks unverified data above overdue work, one for one', () => {
    const data = scoreOf(counters({ data_records_unverified: 1 }), 0.5, TODAY)
    const overdue = scoreOf(counters({ tasks_overdue: 1 }), 0.5, TODAY)
    expect(data).toBeGreaterThan(overdue)
  })

  it('only punishes low completion once there is nothing left to shoot', () => {
    const shooting = scoreOf(counters({ shoots_total: 2, shoots_done: 0 }), 0, TODAY)
    const shot = scoreOf(counters({ shoots_total: 2, shoots_done: 2 }), 0, TODAY)
    expect(shot).toBeGreaterThan(shooting + 25)
  })

  it('ignores closed and cancelled projects entirely', () => {
    const c = counters({ status: 'completed', tasks_overdue: 9, data_records_unverified: 9 })
    expect(scoreOf(c, 0.2, TODAY)).toBe(0)
    expect(scoreOf({ ...c, status: 'cancelled' }, 0.2, TODAY)).toBe(0)
  })

  it('caps staleness so an abandoned project cannot outrank a burning one', () => {
    const ancient = scoreOf(counters({ last_activity_at: '2020-01-01T00:00:00Z' }), 0.5, TODAY)
    const burning = scoreOf(counters({ tasks_overdue: 3 }), 0.5, TODAY)
    expect(burning).toBeGreaterThan(ancient)
  })
})

describe('projectHealth', () => {
  it('flags a project with unverified data and late work as critical', () => {
    const h = projectHealth(counters({ data_records_unverified: 3, tasks_overdue: 2 }), TODAY)
    expect(h.band).toBe('critical')
    expect(h.flags.critical).toBe(true)
    expect(h.flags.data_missing).toBe(true)
    expect(h.flags.overdue).toBe(true)
    expect(h.next_action).toBe('secure_data')
  })

  it('separates high risk from critical', () => {
    const h = projectHealth(counters({ tasks_overdue: 1 }), TODAY)
    expect(h.band).toBe('high')
    expect(h.flags.critical).toBe(false)
    expect(h.flags.high_risk).toBe(true)
  })

  it('calls out low progress only after the shooting is finished', () => {
    const mid = projectHealth(
      counters({ shoots_total: 2, shoots_done: 1, tasks_total: 10, tasks_done: 1 }),
      TODAY,
    )
    expect(mid.flags.low_progress).toBe(false)

    const after = projectHealth(
      counters({ shoots_total: 2, shoots_done: 2, tasks_total: 10, tasks_done: 1 }),
      TODAY,
    )
    expect(after.flags.low_progress).toBe(true)
  })

  it('treats a fully ticked project as completed, whatever its status column says', () => {
    const h = projectHealth(counters({ tasks_total: 4, tasks_done: 4 }), TODAY)
    expect(h.flags.completed).toBe(true)
    expect(h.band).toBe('completed')
    expect(h.score).toBe(0)
  })

  it('never marks an empty project complete', () => {
    // 0 of 0 is not 100% — it is a project nobody has started.
    const h = projectHealth(counters(), TODAY)
    expect(h.flags.completed).toBe(false)
    expect(h.completion).toBe(0)
  })

  it('keeps a healthy project out of every problem bucket', () => {
    const h = projectHealth(
      counters({ tasks_total: 4, tasks_done: 2, shoots_total: 2, shoots_done: 1 }),
      TODAY,
    )
    expect(h.band).toBe('healthy')
    expect(Object.values(h.flags).every((f) => f === false)).toBe(true)
    expect(h.next_action).toBe('keep_going')
  })
})
