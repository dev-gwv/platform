import { describe, expect, it } from 'vitest'
import { displayStatus, matchesRoster, summariseRoster, type RosterRow } from './attendance'

/**
 * The roster rules, now that both sides run them.
 *
 * These used to live in `apps/web` and narrow a page the API had already
 * chosen, while the API narrowed the same roster with its own copy of the
 * derivation. One implementation is the only way a row's badge and the filter
 * that found it cannot disagree — so this is where the rule is written down.
 */
const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  status: 'present',
  check_in_at: '2026-09-16T09:00:00Z',
  check_out_at: '2026-09-16T18:00:00Z',
  engagement_type: 'in_house',
  name: 'Someone',
  ...over,
})

const IN_AND_OUT = row({ name: 'Anita' })
const STILL_IN = row({ name: 'Rahul', check_out_at: null })
const LATE_STILL_IN = row({ name: 'Imran', status: 'late', check_out_at: null })
const NEVER_CAME = row({ name: 'Sana', status: 'absent', check_in_at: null, check_out_at: null })
const FREELANCER = row({ name: 'Vikram', engagement_type: 'freelancer' })

const ROSTER = [IN_AND_OUT, STILL_IN, LATE_STILL_IN, NEVER_CAME, FREELANCER]
const names = (rows: readonly RosterRow[]) => rows.map((r) => r.name)

describe('displayStatus', () => {
  it('reads the stored status for a finished day', () => {
    expect(displayStatus(IN_AND_OUT)).toBe('present')
    expect(displayStatus(NEVER_CAME)).toBe('absent')
  })

  it('derives "not checked out" from the two timestamps, not a fourth status', () => {
    // Storing this would let it drift from the times printed beside it.
    expect(displayStatus(STILL_IN)).toBe('not_checked_out')
    expect(displayStatus(LATE_STILL_IN)).toBe('not_checked_out')
  })
})

describe('matchesRoster', () => {
  it('keeps everyone when nothing is asked for', () => {
    expect(names(ROSTER.filter((r) => matchesRoster(r, {})))).toHaveLength(5)
    expect(names(ROSTER.filter((r) => matchesRoster(r, { status: 'all' })))).toHaveLength(5)
  })

  it('narrows to a derived status', () => {
    expect(names(ROSTER.filter((r) => matchesRoster(r, { status: 'not_checked_out' })))).toEqual([
      'Rahul',
      'Imran',
    ])
  })

  it('still finds someone by the status that was recorded at the door', () => {
    // Imran came in late and has not checked out. He is late either way, so
    // asking for "late" has to find him even though his badge reads
    // "Not checked out" — matching only the derived status would hide him.
    expect(names(ROSTER.filter((r) => matchesRoster(r, { status: 'late' })))).toEqual(['Imran'])
  })

  it('narrows to an engagement', () => {
    expect(names(ROSTER.filter((r) => matchesRoster(r, { type: 'freelancer' })))).toEqual(['Vikram'])
  })

  it('applies both together', () => {
    expect(
      names(ROSTER.filter((r) => matchesRoster(r, { status: 'present', type: 'freelancer' }))),
    ).toEqual(['Vikram'])
  })
})

describe('summariseRoster', () => {
  it('counts anyone who came in as present, late or still inside included', () => {
    const s = summariseRoster(ROSTER)
    expect(s.total).toBe(5)
    expect(s.present).toBe(4)
    expect(s.absent).toBe(1)
    expect(s.notCheckedOut).toBe(2)
    expect(s.percent).toBe(80)
  })

  it('does not count leave or a day off as absent, nor against the percentage', () => {
    const away: RosterRow[] = [
      { status: 'present', check_in_at: '2026-09-01T03:30:00Z', check_out_at: '2026-09-01T12:00:00Z' },
      { status: 'absent', check_in_at: null, check_out_at: null, on_leave: true },
      { status: 'absent', check_in_at: null, check_out_at: null, day_off: 'Diwali' },
      { status: 'absent', check_in_at: null, check_out_at: null },
    ]
    expect(away.map(displayStatus)).toEqual(['present', 'on_leave', 'day_off', 'absent'])
    expect(summariseRoster(away)).toMatchObject({ total: 2, present: 1, absent: 1, onLeave: 1, percent: 50 })
  })

  it('reports 0% for an empty roster rather than NaN', () => {
    const s = summariseRoster([])
    expect(s.percent).toBe(0)
    expect(s.total).toBe(0)
  })

  it('describes whatever set it is given, which is the whole point', () => {
    // The API summarises the filtered roster before cutting the page; the
    // bug this replaced summarised the page, so a studio of forty read
    // "Total 25" on page one.
    const freelancers = ROSTER.filter((r) => matchesRoster(r, { type: 'freelancer' }))
    expect(summariseRoster(freelancers).total).toBe(1)
    expect(summariseRoster(ROSTER.slice(0, 2)).total).toBe(2)
  })
})
