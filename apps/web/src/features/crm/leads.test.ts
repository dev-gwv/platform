import { describe, expect, it } from 'vitest'
import type { CrmLead } from '@ipc/contracts'
import {
  EMPTY_QUERY,
  applyQuery,
  boardColumns,
  countsFor,
  dueBucket,
  hasNoFollowUp,
  isUncontacted,
  summarise,
  wonThisMonth,
} from './leads'

const NOW = new Date('2026-09-01T11:00:00Z')

const lead = (name: string, over: Partial<CrmLead> = {}): CrmLead => ({
  id: `id-${name}`,
  name,
  phone: '9876543210',
  email: null,
  source: 'manual',
  status: 'new',
  assigned_to: 'user-1',
  assignee_name: 'Sana',
  notes: null,
  follow_up_at: null,
  last_contacted_at: null,
  converted_at: null,
  is_hot: false,
  quality: null,
  contacted_status: 'uncontacted',
  is_archived: false,
  merged_into: null,
  converted_project_id: null,
  converted_client_id: null,
  deal_value: null,
  probability: null,
  lost_reason: null,
  lost_competitor: null,
  sla_due_at: null,
  pipeline_id: null,
  stage_id: null,
  stage_name: null,
  contact_id: null,
  crm_company_id: null,
  crm_company_name: null,
  title: null,
  close_date: null,
  event_type: null,
  event_date: null,
  event_location: null,
  alternate_phone: null,
  city: null,
  currency: 'INR',
  score: 0,
  group_name: null,
  date_status: 'unknown',
  date_wanted_by: 0,
  created_at: '2026-08-20T10:00:00Z',
  ...over,
})

const names = (ls: readonly CrmLead[]) => ls.map((l) => l.name)

describe('dueBucket', () => {
  it('splits late, today and ahead', () => {
    expect(dueBucket(lead('a', { follow_up_at: '2026-08-30T10:00:00Z' }), NOW)).toBe('overdue')
    expect(dueBucket(lead('b', { follow_up_at: '2026-09-01T18:00:00Z' }), NOW)).toBe('today')
    expect(dueBucket(lead('c', { follow_up_at: '2026-09-05T09:00:00Z' }), NOW)).toBe('upcoming')
    // Tomorrow is its own bucket, not the head of "upcoming".
    expect(dueBucket(lead('c2', { follow_up_at: '2026-09-02T09:00:00Z' }), NOW)).toBe('tomorrow')
  })

  it('counts a follow-up earlier today as still due today, not overdue', () => {
    // The day is the unit a desk works in — 9am is not "missed" at 11am.
    expect(dueBucket(lead('d', { follow_up_at: '2026-09-01T04:00:00Z' }), NOW)).toBe('today')
  })

  it('has no bucket without a date, or once the lead is closed', () => {
    expect(dueBucket(lead('e'), NOW)).toBe('none')
    // A won lead owes nobody a call, whatever date is still sitting on it.
    const won = lead('f', { status: 'converted', follow_up_at: '2026-08-01T10:00:00Z' })
    expect(dueBucket(won, NOW)).toBe('none')
    expect(dueBucket(lead('g', { status: 'lost', follow_up_at: '2026-08-01T10:00:00Z' }), NOW)).toBe('none')
  })
})

describe('lead states', () => {
  it('calls a lead uncontacted only while nothing has stamped a conversation', () => {
    expect(isUncontacted(lead('a'))).toBe(true)
    expect(isUncontacted(lead('b', { last_contacted_at: '2026-08-25T10:00:00Z' }))).toBe(false)
    expect(isUncontacted(lead('c', { status: 'contacted' }))).toBe(false)
  })

  it('flags an open lead nobody promised to call back', () => {
    expect(hasNoFollowUp(lead('a'))).toBe(true)
    expect(hasNoFollowUp(lead('b', { follow_up_at: '2026-09-09T10:00:00Z' }))).toBe(false)
    // A closed lead is not "missing" a follow-up.
    expect(hasNoFollowUp(lead('c', { status: 'lost' }))).toBe(false)
  })

  it('counts a win only in the month it was won', () => {
    expect(wonThisMonth(lead('a', { status: 'converted', converted_at: '2026-09-01T09:00:00Z' }), NOW)).toBe(true)
    expect(wonThisMonth(lead('b', { status: 'converted', converted_at: '2026-08-31T09:00:00Z' }), NOW)).toBe(false)
    // Converted with no stamp cannot be dated, so it is not this month's.
    expect(wonThisMonth(lead('c', { status: 'converted' }), NOW)).toBe(false)
  })
})

describe('summarise', () => {
  const BOARD = [
    lead('Late', { follow_up_at: '2026-08-28T10:00:00Z', last_contacted_at: '2026-08-27T10:00:00Z', status: 'contacted' }),
    lead('DueToday', { follow_up_at: '2026-09-01T15:00:00Z', status: 'qualified', last_contacted_at: '2026-08-30T10:00:00Z' }),
    lead('Fresh'),
    lead('HotOne', { is_hot: true, status: 'proposal_sent', last_contacted_at: '2026-08-29T10:00:00Z' }),
    lead('WonNow', { status: 'converted', converted_at: '2026-09-01T08:00:00Z' }),
    lead('WonBefore', { status: 'converted', converted_at: '2026-07-02T08:00:00Z' }),
    lead('Gone', { status: 'lost' }),
  ]

  it('counts the working set, not the archive', () => {
    const s = summarise(BOARD, NOW)
    // Total is open leads: the four still in play, not the wins and the loss.
    expect(s.total).toBe(4)
    expect(s.uncontacted).toBe(1)
    expect(s.today).toBe(1)
    expect(s.overdue).toBe(1)
    expect(s.hot).toBe(1)
    expect(s.wonThisMonth).toBe(1)
  })

  it('agrees with the chip counts it sits above', () => {
    const s = summarise(BOARD, NOW)
    const c = countsFor(BOARD, NOW)
    expect(c.due_today).toBe(s.today)
    expect(c.overdue).toBe(s.overdue)
    expect(c.hot).toBe(s.hot)
    expect(c.uncontacted).toBe(s.uncontacted)
  })

  it('is all zeros on an empty desk', () => {
    expect(summarise([], NOW)).toEqual({
      total: 0,
      uncontacted: 0,
      today: 0,
      overdue: 0,
      hot: 0,
      wonThisMonth: 0,
    })
  })
})

describe('applyQuery', () => {
  const LEADS = [
    lead('Late', { follow_up_at: '2026-08-28T10:00:00Z', status: 'contacted', last_contacted_at: '2026-08-27T10:00:00Z' }),
    lead('LateHot', { follow_up_at: '2026-08-29T10:00:00Z', is_hot: true, status: 'contacted', last_contacted_at: '2026-08-27T10:00:00Z' }),
    lead('Today', { follow_up_at: '2026-09-01T15:00:00Z', status: 'qualified', last_contacted_at: '2026-08-30T10:00:00Z' }),
    lead('Nobody', { assigned_to: null, assignee_name: null }),
    lead('Quoted', { status: 'proposal_sent', last_contacted_at: '2026-08-30T10:00:00Z', follow_up_at: '2026-09-10T10:00:00Z' }),
  ]

  it('combines chips with AND, not OR', () => {
    // Someone asking for hot AND overdue wants the short list, not a longer one.
    const both = applyQuery(LEADS, { ...EMPTY_QUERY, filters: ['hot', 'overdue'] }, NOW)
    expect(names(both)).toEqual(['LateHot'])
  })

  it('finds a lead by number, name or assignee', () => {
    expect(names(applyQuery(LEADS, { ...EMPTY_QUERY, search: 'quoted' }, NOW))).toEqual(['Quoted'])
    expect(applyQuery(LEADS, { ...EMPTY_QUERY, search: '98765' }, NOW)).toHaveLength(5)
    expect(applyQuery(LEADS, { ...EMPTY_QUERY, search: 'sana' }, NOW)).toHaveLength(4)
  })

  it('filters unassigned through the assignee control as well as the chip', () => {
    expect(names(applyQuery(LEADS, { ...EMPTY_QUERY, assignee: 'none' }, NOW))).toEqual(['Nobody'])
    expect(names(applyQuery(LEADS, { ...EMPTY_QUERY, filters: ['unassigned'] }, NOW))).toEqual(['Nobody'])
  })

  it('orders late first, then today, then untouched — hot ahead of cold', () => {
    expect(names(applyQuery(LEADS, EMPTY_QUERY, NOW))).toEqual([
      'LateHot',
      'Late',
      'Today',
      'Nobody',
      'Quoted',
    ])
  })

  it('does not mutate the array it was given', () => {
    const before = names(LEADS)
    applyQuery(LEADS, EMPTY_QUERY, NOW)
    expect(names(LEADS)).toEqual(before)
  })
})

describe('boardColumns', () => {
  it('groups open leads by when they are owed, and drops closed ones', () => {
    const columns = boardColumns(
      [
        lead('Late', { follow_up_at: '2026-08-28T10:00:00Z' }),
        lead('Today', { follow_up_at: '2026-09-01T12:00:00Z' }),
        lead('Tomorrow', { follow_up_at: '2026-09-02T12:00:00Z' }),
        lead('Later', { follow_up_at: '2026-09-20T12:00:00Z' }),
        lead('Nothing'),
        lead('Won', { status: 'converted', converted_at: '2026-09-01T08:00:00Z' }),
      ],
      NOW,
    )
    expect(names(columns.overdue)).toEqual(['Late'])
    expect(names(columns.today)).toEqual(['Today'])
    expect(names(columns.tomorrow)).toEqual(['Tomorrow'])
    expect(names(columns.upcoming)).toEqual(['Later'])
    expect(names(columns.none)).toEqual(['Nothing'])
  })
})
