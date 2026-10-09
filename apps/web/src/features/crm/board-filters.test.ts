import { describe, expect, it } from 'vitest'
import type { CrmLead } from '@ipc/contracts'
import { NO_EXTRAS, NO_FACETS, UNSET, activeExtrasCount, activeFacetCount, applyExtras, applyFacets, facetCounts } from './board-filters'

const lead = (p: Partial<CrmLead>): CrmLead =>
  ({ id: Math.random().toString(36), stage_id: 's1', assigned_to: null, event_type: null, quality: null, source: 'manual', tags: [], functions: [], ...p }) as CrmLead

const A = lead({ stage_id: 's1', quality: 'hot', event_type: 'Wedding', tags: [{ id: 't1', name: 'NRI', color: 'blue' }] })
const B = lead({ stage_id: 's2', quality: 'warm', event_type: 'Haldi' })
const C = lead({ stage_id: 's2', quality: 'Super hot', event_type: 'Wedding', assigned_to: 'u1' })

describe('applyFacets', () => {
  it('widens within a facet and narrows across facets', () => {
    expect(applyFacets([A, B, C], { ...NO_FACETS, stage: ['s1', 's2'] })).toHaveLength(3)
    expect(applyFacets([A, B, C], { ...NO_FACETS, stage: ['s2'], event: ['Wedding'] })).toEqual([C])
  })

  it('treats a studio’s own quality like any other', () => {
    expect(applyFacets([A, B, C], { ...NO_FACETS, quality: ['Super hot'] })).toEqual([C])
  })

  it('can ask for the leads with no owner, or no tag', () => {
    expect(applyFacets([A, B, C], { ...NO_FACETS, owner: [UNSET] })).toEqual([A, B])
    expect(applyFacets([A, B, C], { ...NO_FACETS, tag: [UNSET] })).toEqual([B, C])
  })
})

describe('facetCounts', () => {
  it('counts each value', () => {
    expect(facetCounts([A, B, C], 'event').get('Wedding')).toBe(2)
  })
})

describe('several functions on one lead', () => {
  const fn = (event_type: string, event_date: string | null) => ({ id: event_type, event_type, event_date, location: null, guests: null })
  const D = lead({ event_type: 'Haldi', functions: [fn('Haldi', '2026-12-12'), fn('Wedding', '2026-12-14')] })

  it('is found under any of its functions', () => {
    expect(applyFacets([B, D], { ...NO_FACETS, event: ['Wedding'] })).toEqual([D])
    expect(facetCounts([D], 'event').get('Haldi')).toBe(1)
  })

  it('matches an event-date range on any of its dates', () => {
    const now = new Date('2026-09-29T10:00:00')
    expect(applyExtras([D], { ...NO_EXTRAS, eventFrom: '2026-12-13', eventTo: '2026-12-31' }, now)).toEqual([D])
    expect(applyExtras([D], { ...NO_EXTRAS, eventFrom: '2027-01-01' }, now)).toEqual([])
  })
})

describe('applyExtras', () => {
  const now = new Date('2026-09-29T10:00:00')
  const at = (d: string) => new Date(d).toISOString()
  const late = lead({ follow_up_at: at('2026-09-27T10:00:00'), created_at: at('2026-09-01T10:00:00'), contacted_status: 'contacted' })
  const due = lead({ follow_up_at: at('2026-09-29T16:00:00'), created_at: at('2026-09-29T08:00:00'), is_hot: true, deal_value: 150000, contacted_status: 'uncontacted' })
  const soon = lead({ follow_up_at: at('2026-10-03T10:00:00'), created_at: at('2026-09-25T10:00:00'), deal_value: 60000, contacted_status: 'uncontacted' })
  const none = lead({ follow_up_at: null, created_at: at('2026-09-28T10:00:00'), deal_value: null, contacted_status: 'contacted' })
  const all = [late, due, soon, none]

  it('filters by when the next call is due', () => {
    expect(applyExtras(all, { ...NO_EXTRAS, due: 'overdue' }, now)).toEqual([late])
    expect(applyExtras(all, { ...NO_EXTRAS, due: 'today' }, now)).toEqual([due])
    expect(applyExtras(all, { ...NO_EXTRAS, due: 'week' }, now)).toEqual([due, soon])
    expect(applyExtras(all, { ...NO_EXTRAS, due: 'none' }, now)).toEqual([none])
  })

  it('filters by when the lead came in', () => {
    expect(applyExtras(all, { ...NO_EXTRAS, addedDays: 1 }, now)).toEqual([due])
    expect(applyExtras(all, { ...NO_EXTRAS, addedDays: 7 }, now)).toEqual([due, soon, none])
  })

  it('filters by budget, hot and whether anyone has reached them', () => {
    expect(applyExtras(all, { ...NO_EXTRAS, budgetMin: 100000 }, now)).toEqual([due])
    expect(applyExtras(all, { ...NO_EXTRAS, budgetMax: 100000 }, now)).toEqual([soon])
    expect(applyExtras(all, { ...NO_EXTRAS, hotOnly: true }, now)).toEqual([due])
    expect(applyExtras(all, { ...NO_EXTRAS, contacted: 'never' }, now)).toEqual([due, soon])
  })

  it('counts what is switched on', () => {
    expect(activeExtrasCount(NO_EXTRAS)).toBe(0)
    expect(activeExtrasCount({ ...NO_EXTRAS, due: 'today', hotOnly: true, budgetMin: 1 })).toBe(3)
  })
})

describe('activeFacetCount', () => {
  it('counts every pick that narrows the list', () => {
    expect(activeFacetCount(NO_FACETS)).toBe(0)
    expect(activeFacetCount({ ...NO_FACETS, stage: ['s1', 's2'], tag: ['t'] })).toBe(3)
  })
})
