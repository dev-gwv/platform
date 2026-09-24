import { describe, expect, it } from 'vitest'
import type { Deliverable } from '@ipc/contracts'
import {
  deliverableCounts,
  dueLabel,
  groupByShoot,
  isLate,
  nextStage,
  previousStage,
  stageOf,
} from './deliverable-stage'

const d = (over: Partial<Deliverable>): Deliverable =>
  ({
    id: over.id ?? 'd',
    project_id: 'p',
    title: 'Album',
    list_key: 'primary',
    is_additional_charge: false,
    additional_charge_amount: 0,
    visibility_scope: 'client',
    show_on_quotation: true,
    start_rule: 'whole_project',
    status: 'pending',
    ...over,
  }) as Deliverable

describe('stages', () => {
  it('walks To do → Editing → Review → Delivered, and back', () => {
    expect(nextStage('pending')).toBe('in_progress')
    expect(nextStage('in_progress')).toBe('review')
    expect(nextStage('review')).toBe('completed')
    expect(nextStage('completed')).toBeNull()
    expect(nextStage('cancelled')).toBeNull()
    expect(previousStage('review')).toBe('in_progress')
    expect(previousStage('pending')).toBeNull()
  })

  it('reads an unknown stored status as To do', () => {
    expect(stageOf('whatever')).toBe('pending')
  })
})

describe('due dates', () => {
  const today = '2026-10-10'
  it('is late only while open and past due', () => {
    expect(isLate({ status: 'in_progress', estimated_date: '2026-10-09' }, today)).toBe(true)
    expect(isLate({ status: 'completed', estimated_date: '2026-10-09' }, today)).toBe(false)
    expect(isLate({ status: 'cancelled', estimated_date: '2026-10-09' }, today)).toBe(false)
    expect(isLate({ status: 'pending', estimated_date: '2026-10-10' }, today)).toBe(false)
    expect(isLate({ status: 'pending', estimated_date: null }, today)).toBe(false)
  })

  it('says it the way a person would', () => {
    expect(dueLabel({ status: 'pending', estimated_date: '2026-10-10' }, today)).toBe('Due today')
    expect(dueLabel({ status: 'pending', estimated_date: '2026-10-09' }, today)).toBe('1 day late')
    expect(dueLabel({ status: 'review', estimated_date: '2026-10-07' }, today)).toBe('3 days late')
    expect(dueLabel({ status: 'pending', estimated_date: '2026-10-12' }, today)).toBe('Due 12 Oct')
    expect(dueLabel({ status: 'completed', delivered_at: '2026-10-08T10:00:00Z' }, today)).toBe('Delivered 8 Oct')
    expect(dueLabel({ status: 'pending' }, today)).toBeNull()
  })
})

describe('grouping', () => {
  const shoots = [
    { id: 's2', name: 'Wedding', shoot_date: '2026-10-05' },
    { id: 's1', name: 'Haldi', shoot_date: '2026-10-03' },
  ]
  it('puts shoots in date order, keeps empty ones, and ends with the whole project', () => {
    const groups = groupByShoot(
      [d({ id: 'a', shoot_id: 's2' }), d({ id: 'b' }), d({ id: 'c', shoot_id: 'gone' })],
      shoots,
    )
    expect(groups.map((g) => g.shoot?.name ?? 'project')).toEqual(['Haldi', 'Wedding', 'project'])
    expect(groups[0]!.items).toEqual([])
    expect(groups[1]!.items.map((x) => x.id)).toEqual(['a'])
    expect(groups[2]!.items.map((x) => x.id)).toEqual(['b', 'c'])
  })

  it('counts delivered and late, leaving dropped out', () => {
    expect(
      deliverableCounts(
        [
          { status: 'completed' },
          { status: 'in_progress', estimated_date: '2026-10-01' },
          { status: 'cancelled', estimated_date: '2026-10-01' },
          { status: 'pending' },
        ],
        '2026-10-10',
      ),
    ).toEqual({ total: 3, delivered: 1, late: 1 })
  })
})
