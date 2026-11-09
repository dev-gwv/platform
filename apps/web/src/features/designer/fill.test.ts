import { describe, expect, it } from 'vitest'
import { designDoc } from '@ipc/contracts'
import { fillDesign, inr, paymentsLine, roleLines, teamLine, type FillDeliverable } from './fill'
import { blankDoc, templateFor } from './templates'

const d = (title: string, over: Partial<FillDeliverable> = {}): FillDeliverable => ({
  title,
  description: null,
  list_key: 'primary',
  visibility_scope: 'client',
  show_on_quotation: true,
  status: 'pending',
  additional_charge_amount: 0,
  ...over,
})

describe('quotation designer fill', () => {
  it('writes money the Indian way', () => {
    expect(inr(85000)).toBe('INR 85,000/-')
    expect(inr(150000)).toBe('INR 1,50,000/-')
  })

  it('says the team from the roles', () => {
    const reqs = [
      { name: 'Candid Photographer', quantity: 2 },
      { name: 'Cinematographer', quantity: 1 },
      { name: 'Drone', quantity: 0 },
    ]
    expect(teamLine(reqs)).toBe('3 Shooters with Assistants')
    expect(teamLine([])).toBe('')
    expect(roleLines(reqs)).toEqual(['2 Candid Photographer', '1 Cinematographer'])
  })

  it('reads the payment plan', () => {
    expect(
      paymentsLine(
        [
          { label: 'Advance', mode: 'percent', value: 25, due_trigger: null },
          { label: 'On Engagement', mode: 'amount', value: 10000, due_trigger: null },
        ],
        100000,
      ),
    ).toBe('Advance: INR 25,000/-, On Engagement: INR 10,000/-')
  })

  it('makes one event page per live shoot, the deliverables, the add-ons and a valid document', () => {
    const doc = fillDesign({
      template: 'midnight',
      studio: 'Cine World Weddings',
      project: {
        name: 'Mehta Wedding',
        client_name: 'Priya',
        total_cost: 85000,
        deliverables: [
          d('Wedding film', { description: '8-10 minutes' }),
          d('Internal backup', { visibility_scope: 'internal' }),
          d('Pre Wedding Shoot', { list_key: 'additional', additional_charge_amount: 25000 }),
        ],
      },
      shoots: [
        {
          name: 'Haldi',
          shoot_date: '2026-12-04',
          location: 'Jaipur',
          requirements: [{ name: 'Candid Photographer', quantity: 1 }],
        },
        { name: 'Old', shoot_date: null, location: null, status: 'cancelled', requirements: [] },
        { name: 'Wedding', shoot_date: '2026-12-05', location: 'Jaipur', requirements: [] },
      ],
      instalments: [],
    })
    expect(designDoc.parse(doc)).toBeTruthy()
    expect(doc.theme).toEqual(templateFor('midnight').theme)
    expect(doc.pages.map((p) => p.kind)).toEqual([
      'cover',
      'about',
      'event',
      'event',
      'deliverables',
      'addons',
      'thanks',
    ])
    expect(doc.pages[0]!.data.subtitle).toBe('For Priya')
    expect(doc.pages[2]!.data).toMatchObject({
      event: 'Haldi',
      date: '4 December 2026',
      team: '1 Shooter with Assistants',
    })
    expect(doc.pages[4]!.data.lines).toEqual(['Wedding film: 8-10 minutes'])
    expect(doc.pages[4]!.data.total).toBe('Total Investment: INR 85,000/-')
    expect(doc.pages[5]!.data.addons).toEqual([
      { name: 'Pre Wedding Shoot', lines: ['INR 25,000/-'] },
    ])
  })

  it('reuses the cover, about and thank-you pages of the last design, with their theme', () => {
    const previous = blankDoc('blush', 'Cine World')
    previous.pages[1]!.data.body = 'Our own story.'
    const doc = fillDesign({
      template: 'ivory',
      studio: 'X',
      project: null,
      shoots: [],
      instalments: [],
      previous,
    })
    expect(doc.pages[1]!.data.body).toBe('Our own story.')
    expect(doc.pages[1]!.id).not.toBe(previous.pages[1]!.id)
    expect(doc.theme).toEqual(previous.theme)
    expect(designDoc.parse(doc)).toBeTruthy()
  })
})
