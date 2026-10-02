import { describe, expect, it } from 'vitest'
import type { CrmLead } from '@ipc/contracts'
import { BUILTIN_VIEWS, inView, openingView, viewCounts, viewName } from './builtin-views'
import { applyQuery, EMPTY_QUERY } from './leads'

const NOW = new Date('2026-09-27T11:00:00Z')

const lead = (over: Partial<CrmLead> & { id: string }): CrmLead =>
  ({
    name: `Lead ${over.id}`,
    phone: '9876543210',
    email: null,
    source: 'manual',
    status: 'new',
    assigned_to: null,
    assignee_name: null,
    notes: null,
    follow_up_at: null,
    last_contacted_at: '2026-09-20T09:00:00Z',
    converted_at: null,
    is_hot: false,
    quality: null,
    contacted_status: 'contacted',
    is_archived: false,
    merged_into: null,
    converted_project_id: null,
    converted_project_name: null,
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
    created_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }) as CrmLead

const late = lead({ id: 'late', follow_up_at: '2026-09-24T10:00:00Z' })
const dueToday = lead({ id: 'due', follow_up_at: '2026-09-27T16:00:00Z' })
const upcoming = lead({ id: 'soon', follow_up_at: '2026-10-05T10:00:00Z' })
const fresh = lead({ id: 'new', status: 'new', last_contacted_at: null })
const hot = lead({ id: 'hot', is_hot: true, follow_up_at: '2026-10-09T10:00:00Z' })
const won = lead({ id: 'won', status: 'converted', converted_at: '2026-09-10T00:00:00Z' })

const ALL = [late, dueToday, upcoming, fresh, hot, won]

describe('inView', () => {
  // The one view that is not a single chip. A studio clearing its morning does
  // not think of "late" and "due today" as two lists.
  it('Today is what is owed now — late plus due today, and nothing else', () => {
    expect(inView(ALL, 'today', NOW).map((l) => l.id).sort()).toEqual(['due', 'late'])
  })

  it('every other built-in matches the chip it is built from', () => {
    for (const v of BUILTIN_VIEWS) {
      if (!v.filter) continue
      const viaChip = applyQuery(ALL, { ...EMPTY_QUERY, filters: [v.filter] }, NOW)
      expect(inView(ALL, v.key, NOW).map((l) => l.id)).toEqual(viaChip.map((l) => l.id))
    }
  })

  it('All leads means open ones — a won lead is not work', () => {
    const ids = inView(ALL, 'all', NOW).map((l) => l.id)
    expect(ids).not.toContain('won')
    expect(ids).toHaveLength(5)
  })

  it('an unknown key never throws, it falls back to the open list', () => {
    expect(inView(ALL, 'nonsense' as never, NOW).map((l) => l.id)).not.toContain('won')
  })
})

describe('viewCounts', () => {
  it('counts every view in one pass', () => {
    const c = viewCounts(ALL, NOW)
    expect(c.today).toBe(2)
    expect(c.overdue).toBe(1)
    expect(c.uncontacted).toBe(1)
    expect(c.hot).toBe(1)
    expect(c.all).toBe(5)
  })

  it('is all zeros for a studio with nothing', () => {
    expect(Object.values(viewCounts([], NOW)).every((n) => n === 0)).toBe(true)
  })
})

describe('openingView', () => {
  // The page should land on work, not on a list of everything.
  it('opens on Today when something is owed', () => {
    expect(openingView(ALL, NOW)).toBe('today')
  })

  it('falls to Uncontacted when nothing is due but someone is waiting', () => {
    expect(openingView([fresh, upcoming], NOW)).toBe('uncontacted')
  })

  it('falls to All when there is no work at all', () => {
    expect(openingView([upcoming], NOW)).toBe('all')
    expect(openingView([], NOW)).toBe('all')
  })
})

describe('viewName', () => {
  it('names each key', () => {
    expect(viewName('today')).toBe('Today')
    expect(viewName('no_follow_up')).toBe('No follow-up')
  })

  it('never returns undefined for a bad key', () => {
    expect(viewName('nope' as never)).toBe('All leads')
  })
})
