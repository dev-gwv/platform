import { describe, expect, it } from 'vitest'
import { crmLeadCard, type SavedViewQuery } from '@ipc/contracts'
import { leadsPath, placeholderLead } from './lead-reads'
import { capped, BOARD_CAP } from './board-cap'
import { closedOutcomeFor } from './builtin-views'

const card = crmLeadCard.parse({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Priya',
  phone: '9876500001',
  email: null,
  source: 'manual',
  status: 'new',
  assigned_to: null,
  assignee_name: null,
  follow_up_at: null,
  last_contacted_at: null,
  converted_at: null,
  is_hot: false,
  created_at: '2026-11-01T10:00:00.000Z',
  notes_preview: 'Wants candid',
})

describe('the Leads page reads', () => {
  it('asks for open cards, and only says what it was given', () => {
    expect(leadsPath('card', { outcome: 'open' })).toBe('/crm/leads?outcome=open&shape=card')
    expect(leadsPath('full', {})).toBe('/crm/leads')
    expect(leadsPath('card', { outcome: 'all', includeArchived: true, limit: 1 })).toBe(
      '/crm/leads?outcome=all&shape=card&include_archived=1&limit=1',
    )
  })

  it('lets a card stand in for the whole lead, with nothing it lacks made up', () => {
    const lead = placeholderLead(card)
    expect(lead).toMatchObject({ id: card.id, name: 'Priya', notes: null, enquiry_answers: null })
    expect(lead).not.toHaveProperty('notes_preview')
  })

  it('draws 30 cards in a column and counts the rest for "Show N more"', () => {
    const many = Array.from({ length: 75 }, (_, i) => i)
    expect(capped(many, false)).toMatchObject({ more: 75 - BOARD_CAP })
    expect(capped(many, false).shown).toHaveLength(BOARD_CAP)
    expect(capped(many, true)).toEqual({ shown: many, more: 0 })
    expect(capped([1, 2], false)).toEqual({ shown: [1, 2], more: 0 })
  })
})

describe('which closed leads a view needs', () => {
  const view = (id: string, query: Partial<SavedViewQuery>) => ({
    id,
    query: { search: '', filters: [], status: 'all', assignee: 'all', ...query },
  })
  const saved = [
    view('booked', { status: 'converted' }),
    view('lost', { status: 'lost' }),
    view('mine', { assignee: '00000000-0000-4000-8000-000000000009' }),
    view('hot', { filters: ['hot'] }),
    view('proposals', { status: 'proposal_sent' }),
  ]
  it('loads nothing closed for a built-in view or one only about open leads', () => {
    expect(closedOutcomeFor({ kind: 'builtin' }, saved)).toBeNull()
    expect(closedOutcomeFor({ kind: 'saved', id: 'hot' }, saved)).toBeNull()
    expect(closedOutcomeFor({ kind: 'saved', id: 'proposals' }, saved)).toBeNull()
    expect(closedOutcomeFor({ kind: 'saved', id: 'gone' }, saved)).toBeNull()
  })
  it('loads booked, lost, or every lead when the view asks', () => {
    expect(closedOutcomeFor({ kind: 'saved', id: 'booked' }, saved)).toBe('won')
    expect(closedOutcomeFor({ kind: 'saved', id: 'lost' }, saved)).toBe('lost')
    expect(closedOutcomeFor({ kind: 'saved', id: 'mine' }, saved)).toBe('all')
  })
})
