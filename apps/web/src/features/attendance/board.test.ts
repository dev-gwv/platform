import { describe, expect, it } from 'vitest'
import type { TodayBoardRow } from '@ipc/contracts'
import { boardSentence, enabledSinceText, groupOf, lateText, overdue } from './board'

const row = (over: Partial<TodayBoardRow>): TodayBoardRow => ({
  user_id: '00000000-0000-4000-8000-000000000001',
  name: 'Ravi',
  avatar_url: null,
  status: null,
  check_in_at: null,
  check_out_at: null,
  late_minutes: 0,
  place_name: null,
  distance_m: null,
  accuracy_m: null,
  selfie_file_id: null,
  source: null,
  closed_by_system: false,
  leave: null,
  shoot: null,
  expected: '10:00',
  grace: 15,
  ...over,
})
const IN = '2026-10-01T04:52:00Z'
const SHOOT = { name: 'Haldi', start_at: IN, end_at: IN, arrived_at: null }

describe('the Today board', () => {
  it('puts each person where they are', () => {
    expect(groupOf(row({}))).toBe('not_in')
    expect(groupOf(row({ status: 'absent' }))).toBe('not_in')
    expect(groupOf(row({ check_in_at: IN, status: 'present' }))).toBe('in')
    expect(groupOf(row({ check_in_at: IN, status: 'late', late_minutes: 22 }))).toBe('late')
    expect(groupOf(row({ shoot: SHOOT }))).toBe('shoot')
    expect(groupOf(row({ check_in_at: IN, status: 'present', source: 'shoot', shoot: SHOOT }))).toBe('shoot')
    expect(groupOf(row({ leave: 'full' }))).toBe('leave')
    // Half-day leave still comes in for the other half.
    expect(groupOf(row({ leave: 'half' }))).toBe('not_in')
  })

  it('says the day in one sentence', () => {
    const rows = [
      row({ check_in_at: IN, status: 'present' }),
      row({ check_in_at: IN, status: 'late', late_minutes: 22 }),
      row({}),
      row({ shoot: SHOOT }),
      row({ leave: 'full' }),
    ]
    expect(boardSentence(rows)).toBe('2 of 3 in · 1 late · 1 not in yet · 1 on a shoot · 1 on leave')
  })

  it('marks someone overdue only after their start and grace', () => {
    expect(overdue(row({}), '10:15')).toBe(false)
    expect(overdue(row({}), '10:16')).toBe(true)
    expect(overdue(row({ expected: null }), '23:00')).toBe(false)
  })

  it('says lateness plainly', () => {
    expect(lateText(22)).toBe('22 min late')
    expect(lateText(65)).toBe('1h 5m late')
    expect(lateText(120)).toBe('2h late')
  })
})

describe('enabledSinceText', () => {
  it('reads the switch-on moment as India\'s date', () => {
    // 3 Oct, 1:10 am in India is still 2 Oct in UTC.
    expect(enabledSinceText('2026-10-02T19:40:00Z')).toMatch(/^3 Oct 2026$/)
  })
})
