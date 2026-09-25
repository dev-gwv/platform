import { describe, expect, it } from 'vitest'
import type { DataBoardRow, DataRecord } from '@ipc/contracts'
import { bulkIds, chaseMessage, figures, inFocus, laneOf, levelOf, matches, mostPending, nextAction, waNumber } from './board-model'

const PRIYA = '00000000-0000-4000-8000-000000000001'
const AMAN = '00000000-0000-4000-8000-000000000002'

let n = 0
const row = (over: Partial<DataBoardRow>): DataBoardRow => {
  n++
  return {
    key: `s:${n}`,
    slot_id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
    record: null,
    stage: 'missing',
    shoot_id: null,
    shoot_name: 'Haldi',
    shoot_date: '2026-09-20',
    project_id: null,
    project_name: 'Sharma Wedding',
    client_name: 'Sharma',
    user_id: PRIYA,
    user_name: 'Priya Nair',
    phone: '98765 43210',
    role: 'Drone Operator',
    start_at: null,
    end_at: null,
    age_days: 1,
    ...over,
  }
}

describe('lanes and lateness', () => {
  it('puts no record and "with the shooter" in one lane, and leaves issues off the lanes', () => {
    expect(laneOf('missing')).toBe('crew')
    expect(laneOf('with_shooter')).toBe('crew')
    expect(laneOf('backed_up')).toBe('backed_up')
    expect(laneOf('issue')).toBeNull()
    expect(laneOf('archived')).toBeNull()
  })

  it('is late at 3 days and critical at 7, only while the data is not in two places', () => {
    expect(levelOf(row({ age_days: 2 }))).toBe('ok')
    expect(levelOf(row({ age_days: 3 }))).toBe('late')
    expect(levelOf(row({ age_days: 7, stage: 'copied' }))).toBe('critical')
    expect(levelOf(row({ age_days: 30, stage: 'backed_up' }))).toBe('ok')
  })

  it('hides archived and not-needed rows unless asked for', () => {
    expect(inFocus(row({ stage: 'archived' }), 'open')).toBe(false)
    expect(inFocus(row({ stage: 'archived' }), 'archived')).toBe(true)
    expect(inFocus(row({ age_days: 4 }), 'late')).toBe(true)
    expect(inFocus(row({ stage: 'issue' }), 'issues')).toBe(true)
  })
})

describe('the figures and who to chase', () => {
  const rows = [
    row({ user_id: PRIYA, age_days: 8 }),
    row({ user_id: PRIYA, stage: 'with_shooter', age_days: 2 }),
    row({ user_id: AMAN, user_name: 'Aman Verma', age_days: 4 }),
    row({ stage: 'received', age_days: 1 }),
    row({ stage: 'copied', age_days: 5 }),
    row({ stage: 'issue' }),
    row({ stage: 'verified', age_days: 20 }),
  ]

  it('counts what is with crew, waiting to copy, waiting for backup, and in trouble', () => {
    expect(figures(rows)).toEqual({ crew: 3, received: 1, copied: 1, issues: 1, late: 2, critical: 1 })
  })

  it('names who holds the most cards, and how old the oldest is', () => {
    expect(mostPending(rows).map((h) => [h.name, h.count, h.oldest])).toEqual([
      ['Priya Nair', 2, 8],
      ['Aman Verma', 1, 4],
    ])
  })

  it('writes the nudge and a WhatsApp number', () => {
    expect(chaseMessage({ name: 'Priya Nair', count: 2, oldest: 8 })).toBe(
      'Hi Priya, please hand over the cards from 2 shoots to the studio today -- the oldest is 8 days old. Thank you!',
    )
    expect(waNumber('98765 43210')).toBe('919876543210')
    expect(waNumber('+44 20 7946 0958')).toBe('442079460958')
    expect(waNumber('123')).toBeNull()
  })
})

describe('search, next step, bulk', () => {
  it('finds a row by where its copy is, not only by name', () => {
    const r = row({ stage: 'copied', record: { id: 'x', data_label: 'Cards', primary_location_name: 'Studio HDD 4' } as DataRecord })
    expect(matches(r, 'hdd 4')).toBe(true)
    expect(matches(r, 'sangeet')).toBe(false)
    expect(matches(r, 'priya')).toBe(true)
  })

  it('says what to do next', () => {
    expect(nextAction(row({}))).toBe('Collect cards from Priya')
    expect(nextAction(row({ stage: 'copied' }))).toBe('Make the backup')
  })

  it('sends bookings by slot and loose records by record', () => {
    const loose = row({ slot_id: null, record: { id: 'rec-1' } as DataRecord, stage: 'received' })
    const booked = row({})
    expect(bulkIds([loose, booked])).toEqual({ slot_ids: [booked.slot_id], record_ids: ['rec-1'] })
  })
})
