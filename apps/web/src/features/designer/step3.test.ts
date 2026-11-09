import { describe, expect, it } from 'vitest'
import { designDoc } from '@ipc/contracts'
import { fillDesign } from './fill'
import { keepStudioPages, pourProject, STARTERS, starterDoc } from './starters'
import { withTextStyle } from './DesignPageView'
import { stepZoom } from '@/routes/ai-designer-edit'

const project = fillDesign({
  template: 'ivory',
  studio: 'Cine World',
  project: { name: 'Mehta Wedding', client_name: 'Priya', total_cost: 85000, deliverables: [{ title: 'Film', description: null, list_key: 'primary', visibility_scope: 'client', show_on_quotation: true, status: 'pending', additional_charge_amount: 0 }] },
  shoots: [
    { name: 'Haldi', shoot_date: '2026-12-04', location: 'Jaipur', requirements: [] },
    { name: 'Wedding', shoot_date: '2026-12-05', location: 'Jaipur', requirements: [] },
  ],
  instalments: [],
})

describe('quotation designer, step 3', () => {
  it('has six ready-made templates, each a valid design', () => {
    expect(STARTERS).toHaveLength(6)
    for (const s of STARTERS) expect(designDoc.safeParse(starterDoc(s.key, 'Cine World')).success).toBe(true)
  })

  it('pours a project into a template: its events in place of the template\'s, the rest kept', () => {
    const doc = pourProject(starterDoc('royal', 'Cine World'), project)
    const kinds = doc.pages.map((p) => p.kind)
    expect(kinds).toEqual(['cover', 'about', 'event', 'event', 'packages', 'deliverables', 'team', 'thanks'])
    expect(doc.pages.filter((p) => p.kind === 'event').map((p) => p.data.event)).toEqual(['Haldi', 'Wedding'])
    expect(doc.pages[0]!.data.subtitle).toBe('For Priya')
    expect(doc.pages.find((p) => p.kind === 'deliverables')!.data.total).toBe('Total Investment: INR 85,000/-')
    expect(designDoc.safeParse(doc).success).toBe(true)
  })

  it('keeps the studio\'s own story from its last design', () => {
    const last = starterDoc('classic', 'Cine World')
    last.pages[1]!.data.body = 'Our own story.'
    const doc = keepStudioPages(starterDoc('menu', 'Cine World'), last)
    expect(doc.pages.find((p) => p.kind === 'cover')!.data.studio).toBe('Cine World')
    expect(keepStudioPages(starterDoc('classic', 'X'), last).pages[1]!.data.body).toBe('Our own story.')
  })

  it('sets a text the way the text bar says', () => {
    expect(withTextStyle({ fontSize: 30, textAlign: 'left', fontStyle: 'italic' }, { scale: 1.2, align: 'center', color: '#000000', bold: true, italic: false })).toEqual({
      fontSize: 36,
      textAlign: 'center',
      color: '#000000',
      fontWeight: 700,
      fontStyle: 'normal',
    })
    expect(withTextStyle({ fontSize: 20 }, undefined)).toEqual({ fontSize: 20 })
  })

  it('zooms by Canva-like stops', () => {
    expect(stepZoom(0.67, 1)).toBe(75)
    expect(stepZoom(1, 1)).toBe(125)
    expect(stepZoom(1, -1)).toBe(75)
    expect(stepZoom(0.2, -1)).toBe(25)
    expect(stepZoom(2, 1)).toBe(200)
  })
})
