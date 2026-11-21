import type { CrmLeadCard, LeadColumns, LeadPage } from '@ipc/contracts'
import type { BuiltinViewKey } from './builtin-views'
import type { LeadExtras, LeadFacets } from './board-filters'
import type { LeadQuery } from './leads'

/**
 * The Leads page reads its leads a page at a time (speed audit, 21 Nov: a
 * studio with 1,372 open leads downloaded 1.31 MB on every open, and past
 * 2,000 its oldest open leads were silently missing). These are the pure
 * parts: the address a page is asked at -- every filter the page offers goes
 * to the server, so a page is never short because its matches are further
 * down -- and the helpers that read the answers.
 */

/** What narrows the leads, as the page holds it. */
export interface LeadPageFilters {
  /** A built-in view, or null for a saved view (then `saved` says what). */
  view: BuiltinViewKey | null
  /** A saved view's fields, and the list's own chips (InboxTab's query). */
  saved: LeadQuery | null
  facets: LeadFacets
  extras: LeadExtras
  showArchived: boolean
  /** The viewer's "now", for today / overdue and "came in". */
  now: Date
}

/** The viewer's midnight with its offset, e.g. 2026-11-21T00:00:00+05:30. */
export function localDayStart(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

const iso = (d: Date) => d.toISOString()

/** When "came in" starts for a saved view's range, as the list measured it. */
function createdFrom(range: LeadQuery['created'], now: Date): Date | null {
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === 'last7') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
  if (range === 'this_month') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

/**
 * The query string for these filters (no order, cursor or limit). Keys are
 * added in a fixed order and only when they narrow, so equal filters share a
 * cache entry.
 */
export function leadFilterParams(f: LeadPageFilters): URLSearchParams {
  const p = new URLSearchParams()
  const s = f.saved
  // Which leads by how they ended: a saved view can ask for booked or lost.
  let outcome: 'open' | 'won' | 'lost' | 'all' = 'open'
  if (s && f.view === null) {
    if (s.status === 'converted') outcome = 'won'
    else if (s.status === 'lost') outcome = 'lost'
    else if (s.status === 'all' && s.filters.length === 0) outcome = 'all'
  }
  if (outcome !== 'open') p.set('outcome', outcome)
  if (f.showArchived) p.set('include_archived', '1')
  if (f.view && f.view !== 'all') p.set('view', f.view)
  if (s) {
    if (s.filters.length) p.set('quick', [...s.filters].sort().join(','))
    if (s.status !== 'all' && s.status !== 'converted' && s.status !== 'lost') p.set('status', s.status)
    if (s.assignee !== 'all') p.set('assignee', s.assignee)
    if (s.quality !== 'all') p.set('quality', s.quality)
    if (s.tag !== 'all') p.set('tag_id', s.tag)
    const from = createdFrom(s.created, f.now)
    if (from) p.set('created_from', iso(from))
    if (s.search.trim()) p.set('q', s.search.trim().slice(0, 200))
  }
  const facets: [keyof LeadFacets, string][] = [
    ['stage', 'f_stage'],
    ['owner', 'f_owner'],
    ['event', 'f_event'],
    ['quality', 'f_quality'],
    ['tag', 'f_tag'],
    ['source', 'f_source'],
    ['partner', 'f_partner'],
  ]
  for (const [k, key] of facets) {
    const v = f.facets[k]
    if (v.length) p.set(key, [...v].sort().join(','))
  }
  const x = f.extras
  if (x.due) p.set('due', x.due)
  if (x.eventFrom) p.set('event_from', x.eventFrom)
  if (x.eventTo) p.set('event_to', x.eventTo)
  if (x.addedDays) {
    const from = new Date(f.now.getFullYear(), f.now.getMonth(), f.now.getDate() - (x.addedDays - 1))
    // A later "came in" from the same day keeps the same key.
    if (!p.has('created_from') || Date.parse(p.get('created_from')!) < from.getTime()) p.set('created_from', iso(from))
  }
  if (x.budgetMin !== null) p.set('budget_min', String(x.budgetMin))
  if (x.budgetMax !== null) p.set('budget_max', String(x.budgetMax))
  if (x.hotOnly) p.set('hot', '1')
  if (x.contacted) p.set('contacted', x.contacted)
  p.set('day_start', localDayStart(f.now))
  return p
}

/** `/crm/leads/page?…` for one page of the list, or of one board column. */
export function leadPagePath(
  filters: string,
  o: { order: 'urgency' | 'newest'; pipelineId?: string | null; stageId?: string | null; cursor?: string | null; limit?: number },
): string {
  const p = new URLSearchParams(filters)
  if (o.pipelineId) p.set('pipeline_id', o.pipelineId)
  if (o.stageId !== undefined) p.set('stage_id', o.stageId ?? 'none')
  p.set('order', o.order)
  if (o.cursor) p.set('cursor', o.cursor)
  if (o.limit) p.set('limit', String(o.limit))
  return `/crm/leads/page?${p.toString()}`
}

/** `/crm/leads/columns?…`: the board's first cards per stage. */
export function leadColumnsPath(filters: string, pipelineId: string): string {
  const p = new URLSearchParams(filters)
  p.set('pipeline_id', pipelineId)
  return `/crm/leads/columns?${p.toString()}`
}

/** Every card the board holds, column after column. */
export function columnRows(data: LeadColumns | undefined): CrmLeadCard[] {
  return data ? data.columns.flatMap((c) => c.items) : []
}

/** Every row the list's pages hold, in order, each once. */
export function pageRows(pages: readonly LeadPage[] | undefined): CrmLeadCard[] {
  if (!pages) return []
  const seen = new Set<string>()
  const out: CrmLeadCard[] = []
  for (const pg of pages) {
    for (const r of pg.items) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r)
    }
  }
  return out
}

/** A board column with the next page added under it. */
export function appendToColumn(data: LeadColumns, stageId: string | null, page: LeadPage): LeadColumns {
  return {
    ...data,
    columns: data.columns.map((c) => {
      if (c.stage_id !== stageId) return c
      const have = new Set(c.items.map((r) => r.id))
      return { ...c, items: [...c.items, ...page.items.filter((r) => !have.has(r.id))], next_cursor: page.next_cursor }
    }),
  }
}

/** "Showing 100 of 1,372". */
export function showingLine(shown: number, total: number): string {
  const n = (v: number) => v.toLocaleString('en-IN')
  return `Showing ${n(Math.min(shown, total))} of ${n(total)}`
}
