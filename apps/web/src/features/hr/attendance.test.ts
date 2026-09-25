import { describe, expect, it } from 'vitest'
import type { AttendanceDayRow } from '@ipc/contracts'
import {
  EMPTY_FILTERS,
  displayStatus,
  filterRows,
  formatTime,
  hasFilters,
  hoursWorked,
  summarise,
  toCsv,
  todayISO,
} from './attendance'

const row = (name: string, over: Partial<AttendanceDayRow> = {}): AttendanceDayRow => ({
  user_id: `id-${name}`,
  name,
  email: `${name.toLowerCase()}@studio.in`,
  phone: '9876543210',
  engagement_type: 'in_house',
  late_minutes: 0,
  status: 'present',
  check_in_at: '2026-09-01T03:34:00Z',
  check_out_at: '2026-09-01T12:04:00Z',
  corrected_by: null,
  correction_note: null,
  on_leave: false,
  day_off: null,
  ...over,
})

const names = (rows: readonly AttendanceDayRow[]) => rows.map((r) => r.name)

describe('displayStatus', () => {
  it('reports someone still inside as not checked out', () => {
    expect(displayStatus(row('In', { check_out_at: null }))).toBe('not_checked_out')
  })

  it('otherwise passes the recorded status through', () => {
    expect(displayStatus(row('Done'))).toBe('present')
  })

  it('keeps late as late once the day is closed', () => {
    // Late is a fact about arrival; checking out does not undo it.
    expect(displayStatus(row('Late', { status: 'late' }))).toBe('late')
  })

  it('calls a no-show absent even with a stale status', () => {
    expect(displayStatus(row('Away', { status: 'absent', check_in_at: null, check_out_at: null }))).toBe(
      'absent',
    )
  })
})

describe('summarise', () => {
  const ROSTER = [
    row('Closed'),
    row('StillIn', { check_out_at: null }),
    row('Tardy', { status: 'late' }),
    row('NoShow', { status: 'absent', check_in_at: null, check_out_at: null }),
  ]

  it('counts anyone who turned up as present, late included', () => {
    // Late is still turning up, and someone who has not checked out has
    // certainly arrived.
    const s = summarise(ROSTER)
    expect(s.total).toBe(4)
    expect(s.present).toBe(3)
    expect(s.absent).toBe(1)
    expect(s.notCheckedOut).toBe(1)
    expect(s.percent).toBe(75)
  })

  it('reports an empty roster as zero, not NaN', () => {
    expect(summarise([])).toEqual({ total: 0, present: 0, absent: 0, notCheckedOut: 0, onLeave: 0, percent: 0 })
  })

  it('rounds the percentage to a whole number', () => {
    const three = [row('a'), row('b'), row('c', { check_in_at: null })]
    expect(summarise(three).percent).toBe(67)
  })
})

describe('filterRows', () => {
  const ROSTER = [
    row('Anita', { engagement_type: 'freelancer' }),
    row('Rahul', { check_out_at: null }),
    row('Sana', { status: 'absent', check_in_at: null, check_out_at: null }),
  ]

  it('filters on the derived status, not just the stored one', () => {
    expect(names(filterRows(ROSTER, { ...EMPTY_FILTERS, status: 'not_checked_out' }))).toEqual(['Rahul'])
    expect(names(filterRows(ROSTER, { ...EMPTY_FILTERS, status: 'absent' }))).toEqual(['Sana'])
  })

  it('filters by engagement and searches name, email and phone', () => {
    expect(names(filterRows(ROSTER, { ...EMPTY_FILTERS, type: 'freelancer' }))).toEqual(['Anita'])
    expect(names(filterRows(ROSTER, { ...EMPTY_FILTERS, search: 'rahul@' }))).toEqual(['Rahul'])
    expect(filterRows(ROSTER, { ...EMPTY_FILTERS, search: '98765' })).toHaveLength(3)
  })

  it('knows when anything is actually set', () => {
    expect(hasFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasFilters({ ...EMPTY_FILTERS, status: 'absent' })).toBe(true)
  })
})

describe('hoursWorked', () => {
  it('measures the closed day to one decimal', () => {
    expect(hoursWorked(row('a'))).toBe(8.5)
  })

  it('is unknown while someone is still checked in', () => {
    expect(hoursWorked(row('b', { check_out_at: null }))).toBeNull()
    expect(hoursWorked(row('c', { check_in_at: null, check_out_at: null }))).toBeNull()
  })

  it('refuses to report a negative day', () => {
    // Clock skew or a bad correction should read as unknown, not as -3 hours.
    expect(
      hoursWorked(row('d', { check_in_at: '2026-09-01T12:00:00Z', check_out_at: '2026-09-01T09:00:00Z' })),
    ).toBeNull()
  })
})

describe('formatting and export', () => {
  it('shows a dash rather than an empty cell for a missing time', () => {
    expect(formatTime(null)).toBe('—')
    expect(formatTime('2026-09-01T03:34:00Z')).toMatch(/\d/)
  })

  it('exports a header plus one line per row', () => {
    const csv = toCsv([row('Anita'), row('Rahul', { check_out_at: null })])
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Name,Email,Phone')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('Not checked out')
  })

  it('quotes anything that would break the format', () => {
    expect(toCsv([row('Roy, Jr.')])).toContain('"Roy, Jr."')
  })

  it('formats today the way the date input expects', () => {
    expect(todayISO(new Date(2026, 8, 1))).toBe('2026-09-01')
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
