import type { CrmLead } from '@ipc/contracts'

/**
 * The toolbar's facet filters: any of these stages, AND any of these owners,
 * AND any of these event types... Several values in one facet widen it; each
 * facet narrows. Empty means "don't care".
 */
export interface LeadFacets {
  stage: string[]
  owner: string[]
  event: string[]
  quality: string[]
  tag: string[]
  source: string[]
}

export const NO_FACETS: LeadFacets = { stage: [], owner: [], event: [], quality: [], tag: [], source: [] }

/** The value a lead carries for a facet; '' stands for "none". */
export const UNSET = '__none'

const one = (v: string | null | undefined) => (v && v.length > 0 ? v : UNSET)

export function facetValues(l: CrmLead, f: keyof LeadFacets): string[] {
  switch (f) {
    case 'stage':
      return [one(l.stage_id)]
    case 'owner':
      return [one(l.assigned_to)]
    case 'event':
      return [one(l.event_type)]
    case 'quality':
      return [one(l.quality)]
    case 'source':
      return [one(l.source)]
    case 'tag':
      return l.tags.length ? l.tags.map((t) => t.id) : [UNSET]
  }
}

export function applyFacets(leads: readonly CrmLead[], facets: LeadFacets): CrmLead[] {
  const keys = (Object.keys(facets) as (keyof LeadFacets)[]).filter((k) => facets[k].length > 0)
  if (keys.length === 0) return [...leads]
  return leads.filter((l) => keys.every((k) => facetValues(l, k).some((v) => facets[k].includes(v))))
}

/** How many leads carry each value of a facet, for the counts in the menu. */
export function facetCounts(leads: readonly CrmLead[], f: keyof LeadFacets): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of leads) for (const v of facetValues(l, f)) out.set(v, (out.get(v) ?? 0) + 1)
  return out
}

export const activeFacetCount = (f: LeadFacets) => Object.values(f).reduce((n, v) => n + v.length, 0)
