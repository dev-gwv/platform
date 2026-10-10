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

function facetValues(l: CrmLead, f: keyof LeadFacets): string[] {
  switch (f) {
    case 'stage':
      return [one(l.stage_id)]
    case 'owner':
      return [one(l.assigned_to)]
    case 'event': {
      // Any of the functions they asked for: a lead wanting Haldi and Wedding
      // is found under both (0212).
      const types = [...new Set(l.functions.map((f) => f.event_type).filter((t): t is string => !!t))]
      return types.length ? types : [one(l.event_type)]
    }
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

/**
 * The filters behind the Filter button: when the next call is due, when the
 * event is, when the lead came in, the budget, hot only, reached or not.
 * Each one narrows; null means "don't care".
 */
export interface LeadExtras {
  due: 'overdue' | 'today' | 'week' | 'none' | null
  /** yyyy-mm-dd; a lead matches when any of its functions falls in the range. */
  eventFrom: string | null
  eventTo: string | null
  /** Added in the last N days. */
  addedDays: 1 | 7 | 30 | null
  budgetMin: number | null
  budgetMax: number | null
  hotOnly: boolean
  contacted: 'never' | 'yes' | null
}

export const NO_EXTRAS: LeadExtras = {
  due: null,
  eventFrom: null,
  eventTo: null,
  addedDays: null,
  budgetMin: null,
  budgetMax: null,
  hotOnly: false,
  contacted: null,
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Every date the lead is asking for: its functions', or the lead's own. */
const eventDates = (l: CrmLead): string[] => {
  const ds = l.functions.map((f) => f.event_date).filter((d): d is string => !!d)
  return ds.length ? ds : l.event_date ? [l.event_date] : []
}

export function applyExtras(leads: readonly CrmLead[], x: LeadExtras, now: Date): CrmLead[] {
  const today = dayStart(now).getTime()
  const tomorrow = today + 86_400_000
  const weekEnd = today + 8 * 86_400_000
  return leads.filter((l) => {
    if (x.due) {
      const at = l.follow_up_at ? new Date(l.follow_up_at).getTime() : null
      if (x.due === 'none' && at !== null) return false
      if (x.due === 'overdue' && !(at !== null && at < today)) return false
      if (x.due === 'today' && !(at !== null && at >= today && at < tomorrow)) return false
      if (x.due === 'week' && !(at !== null && at >= today && at < weekEnd)) return false
    }
    if (x.eventFrom || x.eventTo) {
      const hit = eventDates(l).some((d) => (!x.eventFrom || d >= x.eventFrom) && (!x.eventTo || d <= x.eventTo))
      if (!hit) return false
    }
    if (x.addedDays && new Date(l.created_at).getTime() < today - (x.addedDays - 1) * 86_400_000) return false
    if (x.budgetMin !== null && (l.deal_value ?? -1) < x.budgetMin) return false
    if (x.budgetMax !== null && (l.deal_value == null || l.deal_value > x.budgetMax)) return false
    if (x.hotOnly && !l.is_hot) return false
    if (x.contacted === 'never' && l.contacted_status !== 'uncontacted') return false
    if (x.contacted === 'yes' && l.contacted_status === 'uncontacted') return false
    return true
  })
}

/** How many extra filters are on, for the badge on the Filter button. */
export const activeExtrasCount = (x: LeadExtras): number =>
  [x.due, x.eventFrom || x.eventTo, x.addedDays, x.budgetMin !== null || x.budgetMax !== null, x.hotOnly || null, x.contacted].filter(
    (v) => v !== null && v !== undefined && v !== false,
  ).length
