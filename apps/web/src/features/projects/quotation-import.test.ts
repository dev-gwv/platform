import { describe, expect, it } from 'vitest'
import type { QuotationReading } from '@ipc/contracts'
import { readingToDraft } from './quotation-import'
import { estimatedDateFor, toShootRequests } from './wizard'

const reading: QuotationReading = {
  client_name: 'Nupur Jain',
  client_phone: '+91 98765 43210',
  client_email: null,
  project_name: null,
  events: [
    { name: 'Haldi', date: '2027-02-13', start_time: null, hours: 6, city: 'Delhi', guests: null, team: [{ role: 'Candid Photographer', quantity: 1 }] },
    { name: 'Rituals and wedding', date: '2027-02-14', start_time: '16:00', hours: 12, city: 'Delhi', guests: 400, team: [{ role: 'Drone', quantity: 1 }] },
  ],
  deliverables: [
    { title: 'Instagram reels', kind: 'reel', due_days: 14, is_add_on: false, price: null },
    { title: 'Highlight film', kind: 'film', due_days: null, is_add_on: false, price: null },
    { title: 'Extra album', kind: 'album', due_days: null, is_add_on: true, price: 25000 },
  ],
  total: 200000,
  payment_plan: [],
  notes: 'Team meals to be arranged by the client',
}

describe('readingToDraft', () => {
  const draft = readingToDraft(reading)
  it('names the project and the client from the quotation', () => {
    expect(draft).toMatchObject({ name: 'Nupur Jain Wedding', new_client_name: 'Nupur Jain', new_client_phone: '+919876543210', package_cost: '200000' })
  })
  it('makes each event a day with its team', () => {
    expect(draft.shoots[1]).toMatchObject({ name: 'Rituals and wedding', shoot_date: '2027-02-14', start_time: '16:00', hours: '12', guests: '400' })
    expect(draft.shoots[0]!.requirements).toEqual([{ name: 'Candid Photographer', quantity: '1' }])
    expect(toShootRequests(draft, '00000000-0000-0000-0000-000000000000')).toHaveLength(2)
  })
  it('dates a deliverable from the quotation, else the usual days', () => {
    expect(estimatedDateFor(draft, draft.deliverables[0]!)).toBe('2027-02-28')
    expect(draft.deliverables[1]!.due_basis).toBe('after_wedding_day')
    expect(draft.deliverables[1]!.lead_days).toBe('30')
  })
  it('keeps a priced add-on as an extra charge', () => {
    expect(draft.deliverables[2]).toMatchObject({ is_additional_charge: true, additional_charge_amount: '25000' })
  })
})
