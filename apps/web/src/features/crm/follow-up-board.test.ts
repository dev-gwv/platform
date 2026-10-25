import { describe, expect, it } from 'vitest'
import type { CrmActivity } from '@ipc/contracts'
import { NONE, NO_FILTERS, activeFilterCount, boardColumns, boardSentence, filterFollowUps, peopleOn } from './follow-up-board'

// Sun 28 Sep 2026, 16:00 local.
const NOW = new Date(2026, 8, 28, 16, 0)
const RAVI = '00000000-0000-4000-8000-000000000001'
const NEHA = '00000000-0000-4000-8000-000000000002'

let n = 0
const task = (p: Partial<CrmActivity>): CrmActivity => ({
  id: `00000000-0000-4000-8000-1000000000${String(++n).padStart(2, '0')}`,
  lead_id: null,
  lead_name: 'Priya',
  lead_phone: '+91 98123 45670',
  contact_id: null,
  contact_name: null,
  type: 'task',
  direction: 'none',
  subject: 'Call',
  body: null,
  outcome: null,
  started_at: null,
  ended_at: null,
  duration_s: null,
  due_at: null,
  done_at: null,
  assigned_to: null,
  assignee_name: null,
  actor_id: null,
  actor_name: null,
  whose_id: RAVI,
  whose_name: 'Ravi',
  provider: 'manual',
  external_id: null,
  location: null,
  priority: 'Normal',
  meta: {},
  created_at: NOW.toISOString(),
  ...p,
})

const late = task({ due_at: new Date(2026, 8, 27, 11).toISOString(), lead_name: 'Meera', priority: 'Urgent' })
const today = task({ due_at: new Date(2026, 8, 28, 18).toISOString(), subject: 'Site visit', whose_id: NEHA, whose_name: 'Neha' })
const tomorrow = task({ due_at: new Date(2026, 8, 29, 11).toISOString(), body: 'Ask about the haldi' })
const later = task({ due_at: new Date(2026, 9, 20, 11).toISOString(), whose_id: null, whose_name: null })
const undated = task({ subject: 'WhatsApp' })
const all = [later, today, undated, tomorrow, late]

describe('boardColumns', () => {
  it('puts each follow-up under when it is owed, soonest first', () => {
    const c = boardColumns(all, NOW)
    expect(c.overdue).toEqual([late])
    expect(c.today).toEqual([today])
    expect(c.tomorrow).toEqual([tomorrow])
    expect(c.later).toEqual([later])
    expect(c.undated).toEqual([undated])
  })
})

describe('boardSentence', () => {
  it('says what is owed this week in words', () => {
    expect(boardSentence(boardColumns(all, NOW))).toBe('1 overdue · 1 today · 1 more this week')
    expect(boardSentence(boardColumns([later], NOW))).toBe('Nothing due this week · 1 later')
    expect(boardSentence(boardColumns([], NOW))).toBe('No follow-ups waiting')
  })
})

describe('filterFollowUps', () => {
  it('narrows by person, nobody, type, priority and search', () => {
    expect(filterFollowUps(all, { ...NO_FILTERS, people: [NEHA] })).toEqual([today])
    expect(filterFollowUps(all, { ...NO_FILTERS, people: [NONE] })).toEqual([later])
    expect(filterFollowUps(all, { ...NO_FILTERS, types: ['site visit'] })).toEqual([today])
    expect(filterFollowUps(all, { ...NO_FILTERS, priorities: ['Urgent'] })).toEqual([late])
    expect(filterFollowUps(all, { ...NO_FILTERS, search: 'haldi' })).toEqual([tomorrow])
    expect(filterFollowUps(all, { ...NO_FILTERS, search: 'meera' })).toEqual([late])
    expect(filterFollowUps(all, { ...NO_FILTERS, search: '45670' })).toHaveLength(5)
  })

  it('counts the filters in use', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    expect(activeFilterCount({ people: [RAVI], types: [], priorities: ['Urgent', 'High'], search: ' x ' })).toBe(4)
  })
})

describe('peopleOn', () => {
  it('lists who has follow-ups, most first, with nobody named', () => {
    expect(peopleOn(all)).toEqual([
      { id: RAVI, name: 'Ravi', count: 3 },
      { id: NEHA, name: 'Neha', count: 1 },
      { id: NONE, name: 'Nobody', count: 1 },
    ])
  })
})
