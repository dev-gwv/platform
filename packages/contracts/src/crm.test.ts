import { describe, expect, it } from 'vitest'
import { bulkLeadPatch, crmLead, crmLeadCard, leadsQuery, leadsSummary, updateLeadRequest, updateSavedViewRequest } from './crm'

/**
 * Losing without a reason must fail at the contract, not deep in SQL: the
 * database trigger raises the same rule as 22023, but a 422 naming the field
 * is what the UI can point at.
 */
describe('lost moves require their reason', () => {
  it('updateLeadRequest accepts a lost move with a reason', () => {
    const r = updateLeadRequest.safeParse({ status: 'lost', lost_reason: 'Went elsewhere' })
    expect(r.success).toBe(true)
  })

  it('updateLeadRequest rejects a lost move without one', () => {
    for (const patch of [{ status: 'lost' }, { status: 'lost', lost_reason: null }, { status: 'lost', lost_reason: 'No' }]) {
      const r = updateLeadRequest.safeParse(patch)
      expect(r.success).toBe(false)
    }
  })

  it('bulkLeadPatch accepts a lost batch with a reason', () => {
    const r = bulkLeadPatch.safeParse({
      ids: ['11111111-1111-1111-8111-111111111111'],
      patch: { status: 'lost', lost_reason: 'Budget' },
    })
    expect(r.success).toBe(true)
  })

  it('bulkLeadPatch rejects a lost batch without one, and an empty patch', () => {
    const ids = ['11111111-1111-1111-8111-111111111111']
    expect(bulkLeadPatch.safeParse({ ids, patch: { status: 'lost' } }).success).toBe(false)
    expect(bulkLeadPatch.safeParse({ ids, patch: {} }).success).toBe(false)
  })
})

describe('updateSavedViewRequest', () => {
  it('accepts a rename, a visibility change, or both — but not nothing', () => {
    expect(updateSavedViewRequest.safeParse({ name: 'Hot today' }).success).toBe(true)
    expect(updateSavedViewRequest.safeParse({ visibility: 'team' }).success).toBe(true)
    expect(updateSavedViewRequest.safeParse({}).success).toBe(false)
    expect(updateSavedViewRequest.safeParse({ visibility: 'everyone' }).success).toBe(true)
  })
})

describe('the Leads page reads (speed plan)', () => {
  const full = crmLead.parse({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Priya',
    phone: '9876500001',
    email: null,
    source: 'manual',
    status: 'new',
    assigned_to: null,
    assignee_name: null,
    notes: 'A long note '.repeat(40),
    enquiry_answers: [{ question: 'Budget?', answer: '3 lakh' }],
    follow_up_at: null,
    last_contacted_at: null,
    converted_at: null,
    is_hot: false,
    created_at: '2026-11-01T10:00:00.000Z',
  })

  it('keeps a card to what the page reads: no notes, answers or booked project', () => {
    const card = crmLeadCard.parse({ ...full, notes_preview: 'A long note' })
    expect(card).not.toHaveProperty('notes')
    expect(card).not.toHaveProperty('enquiry_answers')
    expect(card).not.toHaveProperty('converted_project_name')
    expect(card).toMatchObject({ id: full.id, status: 'new', notes_preview: 'A long note', tags: [], functions: [] })
    expect(JSON.stringify(card).length).toBeLessThan(JSON.stringify(full).length / 1.5)
  })

  it('takes an outcome and a shape, and leaves the old default alone', () => {
    expect(leadsQuery.parse({ outcome: 'open', shape: 'card' })).toMatchObject({ outcome: 'open', shape: 'card' })
    expect(leadsQuery.parse({}).outcome).toBeUndefined()
    expect(leadsQuery.safeParse({ outcome: 'booked' }).success).toBe(false)
  })

  it('reads the pipeline summary', () => {
    const s = leadsSummary.parse({
      stages: [{ stage_id: null, count: 2, value: 150000 }],
      open_total: 2,
      open_value: 150000,
      not_contacted: 1,
    })
    expect(s.stages[0]!.count).toBe(2)
  })
})
