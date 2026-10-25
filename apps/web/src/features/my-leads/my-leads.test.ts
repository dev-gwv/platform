import { describe, expect, it } from 'vitest'
import type { MyLead } from '@ipc/contracts'
import { leadState, myLeadsFor, myLeadsSentence } from './my-leads'

// Sun 28 Sep 2026, 16:00 local.
const NOW = new Date(2026, 8, 28, 16, 0)
let n = 0
const lead = (p: Partial<MyLead>): MyLead => ({
  id: `00000000-0000-4000-8000-2000000000${String(++n).padStart(2, '0')}`,
  name: 'Priya',
  phone: '9812345670',
  email: null,
  status: 'new',
  stage_name: 'New',
  stage_color: 'blue',
  quality: null,
  event_type: 'Wedding',
  event_date: null,
  city: 'Jaipur',
  partner_name: null,
  enquiry_occasion: null,
  follow_up_at: null,
  next_subject: null,
  last_note: null,
  last_note_at: null,
  created_at: NOW.toISOString(),
  ...p,
})

const late = lead({ name: 'Meera', follow_up_at: new Date(2026, 8, 27, 11).toISOString() })
const today = lead({ name: 'Kavya', follow_up_at: new Date(2026, 8, 28, 18).toISOString() })
const soon = lead({ name: 'Ritu', follow_up_at: new Date(2026, 9, 2, 11).toISOString() })
const none = lead({ name: 'Anu', city: 'Udaipur' })
const booked = lead({ name: 'Sara', status: 'converted' })
const all = [soon, booked, none, today, late]

describe('leadState', () => {
  it('reads late, today, later, no follow-up and closed', () => {
    expect([late, today, soon, none, booked].map((l) => leadState(l, NOW))).toEqual(['late', 'today', 'soon', 'none', 'closed'])
  })
})

describe('myLeadsFor', () => {
  it('puts what to do now first, and keeps booked and lost apart', () => {
    expect(myLeadsFor('todo', all, '', NOW).map((l) => l.name)).toEqual(['Meera', 'Kavya', 'Anu'])
    expect(myLeadsFor('all', all, '', NOW).map((l) => l.name)).toEqual(['Meera', 'Kavya', 'Anu', 'Ritu'])
    expect(myLeadsFor('closed', all, '', NOW).map((l) => l.name)).toEqual(['Sara'])
  })

  it('finds by name, city or number', () => {
    expect(myLeadsFor('all', all, 'udai', NOW).map((l) => l.name)).toEqual(['Anu'])
    expect(myLeadsFor('all', all, '45670', NOW)).toHaveLength(4)
  })
})

describe('myLeadsSentence', () => {
  it('says what waits in one line', () => {
    expect(myLeadsSentence(all, NOW)).toBe('4 open leads given to you · 1 late · 1 to follow up today · 1 with no follow-up set')
    expect(myLeadsSentence([], NOW)).toBe('No leads given to you yet.')
  })
})
