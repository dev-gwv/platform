import { describe, expect, it } from 'vitest'
import type { CrmLead } from '@ipc/contracts'
import { NO_FACETS, UNSET, applyFacets, facetCounts } from './board-filters'

const lead = (p: Partial<CrmLead>): CrmLead =>
  ({ id: Math.random().toString(36), stage_id: 's1', assigned_to: null, event_type: null, quality: null, source: 'manual', tags: [], ...p }) as CrmLead

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
