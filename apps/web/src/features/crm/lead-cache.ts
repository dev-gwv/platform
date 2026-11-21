import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { trimToFirstPage } from '@/shared/api/reset-pages'
import type { BulkLeadPatch, CrmLead, CrmTag, LeadTag, UpdateLeadRequest } from '@ipc/contracts'

/**
 * Change a lead in the browser's copy before the server answers, so a card
 * dropped on a column lands there at once (the production board does the same,
 * `features/board/api.ts`). After the save only what can have changed is asked
 * for again -- the lead, its timeline, the stage counts -- never every CRM list.
 */

/** The parts of a lead row a change can touch at once, without the server. */
export type LeadRowPatch = Partial<
  Pick<
    CrmLead,
    | 'stage_id'
    | 'stage_name'
    | 'status'
    | 'assigned_to'
    | 'assignee_name'
    | 'follow_up_at'
    | 'is_hot'
    | 'quality'
    | 'contacted_status'
    | 'is_archived'
    | 'tags'
    | 'name'
    | 'phone'
    | 'email'
    | 'city'
    | 'deal_value'
    | 'probability'
    | 'event_type'
    | 'event_date'
    | 'event_location'
    | 'title'
    | 'close_date'
    | 'lost_reason'
    | 'partner_id'
  >
>

const COPIED = [
  'status',
  'assigned_to',
  'follow_up_at',
  'is_hot',
  'quality',
  'contacted_status',
  'is_archived',
  'name',
  'phone',
  'email',
  'city',
  'deal_value',
  'probability',
  'event_type',
  'event_date',
  'event_location',
  'title',
  'close_date',
  'lost_reason',
  'partner_id',
] as const satisfies readonly (keyof UpdateLeadRequest & keyof LeadRowPatch)[]

/**
 * What a PATCH changes on the row, as far as the browser can tell. Fields the
 * server works out (score, functions, names of things) are left to the refresh.
 * Quality 'hot' is the hot flag (the database keeps them in step).
 */
export function rowPatchFrom(patch: UpdateLeadRequest): LeadRowPatch {
  const out: Record<string, unknown> = {}
  for (const k of COPIED) {
    if (patch[k] !== undefined) out[k] = patch[k]
  }
  if (patch.quality !== undefined) out.is_hot = patch.quality === 'hot'
  if (patch.assigned_to === null) out.assignee_name = null
  return out as LeadRowPatch
}

/** The same for the bulk bar's patch, which can also move a stage. */
export function bulkRowPatch(patch: BulkLeadPatch['patch']): LeadRowPatch {
  return { ...rowPatchFrom(patch), ...(patch.stage_id ? { stage_id: patch.stage_id } : {}) }
}

/** A list with one lead changed; the same array when the lead is not in it. */
export function patchLeadRows<T extends { id: string }>(rows: T[] | undefined, ids: ReadonlySet<string>, patch: object): T[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const next = rows.map((r) => {
    if (!ids.has(r.id)) return r
    changed = true
    return { ...r, ...patch } as T
  })
  return changed ? next : rows
}

type Paged = { items: { id: string }[] }
type Columns = { columns: ({ stage_id: string | null; total: number; value?: number | undefined; next_cursor?: string | null | undefined } & Paged)[] }
const isPaged = (d: unknown): d is Paged => !!d && typeof d === 'object' && Array.isArray((d as Paged).items)
const isInfinite = (d: unknown): d is { pages: unknown[] } =>
  !!d && typeof d === 'object' && Array.isArray((d as { pages?: unknown }).pages)
const isColumns = (d: unknown): d is Columns => !!d && typeof d === 'object' && Array.isArray((d as Columns).columns)

/**
 * The board's columns with these leads changed. A new stage moves the card to
 * the top of its new column at once, and both columns' counts and values
 * follow, so a dropped card never waits for the server (paged board, 21 Nov).
 */
export function patchColumns<T extends Columns>(data: T, ids: ReadonlySet<string>, patch: object): T {
  const stageId = (patch as { stage_id?: string | null }).stage_id
  let changed = false
  const moved: { id: string; deal_value?: number | null }[] = []
  let columns = data.columns.map((c) => {
    if (!c.items.some((r) => ids.has(r.id))) return c
    changed = true
    if (stageId === undefined || c.stage_id === stageId) {
      return { ...c, items: c.items.map((r) => (ids.has(r.id) ? { ...r, ...patch } : r)) }
    }
    const leaving = c.items.filter((r) => ids.has(r.id))
    moved.push(...leaving.map((r) => ({ ...r, ...patch })))
    const lost = leaving.reduce((n, r) => n + ((r as { deal_value?: number | null }).deal_value ?? 0), 0)
    return {
      ...c,
      items: c.items.filter((r) => !ids.has(r.id)),
      total: Math.max(0, c.total - leaving.length),
      ...(c.value !== undefined ? { value: c.value - lost } : {}),
    }
  })
  if (moved.length && stageId !== undefined) {
    const gained = moved.reduce((n, r) => n + (r.deal_value ?? 0), 0)
    const target = columns.find((c) => c.stage_id === stageId)
    if (target) {
      columns = columns.map((c) =>
        c === target
          ? { ...c, items: [...moved, ...c.items], total: c.total + moved.length, ...(c.value !== undefined ? { value: c.value + gained } : {}) }
          : c,
      )
    } else {
      columns = [...columns, { stage_id: stageId, total: moved.length, value: gained, items: moved, next_cursor: null }]
    }
  }
  return changed ? { ...data, columns } : data
}

/**
 * Any cached shape of lead rows with these leads changed: a plain list, one
 * page (`{items}`), the list's pages (`{pages}`) or the board (`{columns}`).
 * The same object comes back when none of the leads is in it.
 */
export function patchLeadData(data: unknown, ids: ReadonlySet<string>, patch: object): unknown {
  if (Array.isArray(data)) return patchLeadRows(data as { id: string }[], ids, patch)
  if (isColumns(data)) return patchColumns(data, ids, patch)
  if (isInfinite(data)) {
    let changed = false
    const pages = data.pages.map((pg) => {
      const next = patchLeadData(pg, ids, patch)
      if (next !== pg) changed = true
      return next
    })
    return changed ? { ...data, pages } : data
  }
  if (isPaged(data)) {
    const items = patchLeadRows(data.items, ids, patch)
    return items === data.items ? data : { ...data, items }
  }
  return data
}

/** The first of these leads found in any cached shape. */
export function findLead(data: unknown, ids: ReadonlySet<string>): CrmLead | null {
  if (Array.isArray(data)) return (data as CrmLead[]).find((r) => ids.has(r.id)) ?? null
  if (isColumns(data)) {
    for (const c of data.columns) {
      const hit = findLead(c.items, ids)
      if (hit) return hit
    }
    return null
  }
  if (isInfinite(data)) {
    for (const pg of data.pages) {
      const hit = findLead(pg, ids)
      if (hit) return hit
    }
    return null
  }
  if (isPaged(data)) return findLead(data.items, ids)
  return null
}

/** One lead with the patch on it; undefined stays undefined. */
export function patchLead<T extends { id: string }>(lead: T | undefined, patch: object): T | undefined {
  return lead && typeof lead === 'object' ? ({ ...lead, ...patch } as T) : lead
}

/** The label rows for a set of ids, from the studio's list; unknown ids are dropped. */
export function tagsFor(tagIds: readonly string[], all: readonly CrmTag[] | undefined): LeadTag[] | undefined {
  if (!all) return undefined
  const byId = new Map(all.map((t) => [t.id, t]))
  const out: LeadTag[] = []
  for (const id of tagIds) {
    const t = byId.get(id)
    if (t) out.push({ id: t.id, name: t.name, color: t.color })
  }
  return out
}

/** Which list a status falls in, the way the server cuts them (`lead-reads.ts`). */
function outcomeOf(status: CrmLead['status'] | undefined): 'open' | 'won' | 'lost' | undefined {
  if (status === undefined) return undefined
  if (status === 'converted') return 'won'
  if (status === 'lost') return 'lost'
  return 'open'
}

/**
 * Can this change move a lead into or out of a list? Lists are cut by outcome
 * (open / won / lost) and by archived, so a status or archive change can; a
 * stage, label, owner or date cannot.
 */
export function changesMembership(patch: LeadRowPatch, before?: Pick<CrmLead, 'status' | 'is_archived'> | null): boolean {
  if (patch.is_archived !== undefined && patch.is_archived !== before?.is_archived) return true
  if (patch.status !== undefined && outcomeOf(patch.status) !== outcomeOf(before?.status)) return true
  return false
}

/**
 * Fields whose new value is all a card shows of them, so the browser's copy is
 * already right after the patch. Anything else (a new owner's name, a partner's
 * name, the events a date rewrites, the notes preview) needs the lists again.
 */
const SHOWN_AS_SENT: ReadonlySet<string> = new Set([
  'quality',
  'is_hot',
  'contacted_status',
  'follow_up_at',
  'name',
  'phone',
  'email',
  'city',
  'deal_value',
  'probability',
  'title',
  'close_date',
])

/** Must the lead lists be asked for again after this PATCH? */
export function listsNeedRefresh(patch: UpdateLeadRequest, before?: Pick<CrmLead, 'status' | 'is_archived'> | null): boolean {
  if (changesMembership(rowPatchFrom(patch), before)) return true
  return Object.keys(patch).some((k) => (patch as Record<string, unknown>)[k] !== undefined && !SHOWN_AS_SENT.has(k))
}

/** The keys a lead's rows live under: lists (card, full), searches, and the lead itself. */
const LIST_KEYS: QueryKey[] = [
  ['crm', 'leads', 'card'],
  ['crm', 'leads', 'full'],
  ['crm', 'lead-search'],
]
const oneKey = (id: string): QueryKey => ['crm', 'leads', 'one', id]

export interface LeadSnapshot {
  lists: [QueryKey, unknown][]
  ones: [QueryKey, unknown][]
  /** The lead as it was, from whichever copy held it (for the membership check). */
  before: CrmLead | null
}

/** Patch every copy of these leads now; hand back what was there to put back on error. */
export async function applyLeadPatch(qc: QueryClient, ids: readonly string[], patch: LeadRowPatch): Promise<LeadSnapshot> {
  const set = new Set(ids)
  await Promise.all([
    ...LIST_KEYS.map((queryKey) => qc.cancelQueries({ queryKey })),
    ...ids.map((id) => qc.cancelQueries({ queryKey: oneKey(id), exact: true })),
  ])
  const lists: [QueryKey, unknown][] = []
  let before: CrmLead | null = null
  for (const queryKey of LIST_KEYS) {
    for (const [key, data] of qc.getQueriesData<unknown>({ queryKey })) {
      if (!data) continue
      if (!before) before = findLead(data, set)
      const next = patchLeadData(data, set, patch)
      if (next !== data) {
        lists.push([key, data])
        qc.setQueryData(key, next)
      }
    }
  }
  const ones: [QueryKey, unknown][] = []
  for (const id of ids) {
    const key = oneKey(id)
    const data = qc.getQueryData<CrmLead>(key)
    if (!data) continue
    if (!before) before = data
    ones.push([key, data])
    qc.setQueryData(key, patchLead(data, patch))
  }
  return { lists, ones, before }
}

/** Put every copy back as it was before the change. */
export function rollbackLeadPatch(qc: QueryClient, snap: LeadSnapshot | undefined) {
  if (!snap) return
  for (const [key, data] of [...snap.lists, ...snap.ones]) qc.setQueryData(key, data)
}

/**
 * After something about leads changed that the browser cannot patch itself (a
 * note or call logged, a lead added): the lead reads on screen are asked for
 * again; the studio's set-up (pipelines, labels, templates, settings) is only
 * marked out of date.
 */
export function refreshLeadReads(qc: QueryClient) {
  trimToFirstPage(qc, PAGED)
  void qc.invalidateQueries({ queryKey: ['crm'], refetchType: 'none' })
  for (const queryKey of LEAD_READS) void qc.invalidateQueries({ queryKey })
}

const LEAD_READS: QueryKey[] = [
  ['crm', 'leads'],
  ['crm', 'lead-search'],
  ['crm', 'timeline'],
  ['crm', 'activities'],
  ['crm', 'call-queue'],
  ['crm', 'my-day'],
  ['crm', 'team-day'],
  ['crm', 'reminders'],
]

/**
 * After a lead changed: every CRM read is marked out of date (so a page opened
 * next asks again), but only the ones that can show this change and are on
 * screen are asked for now. `lists` adds the lead lists, for a change that can
 * move a lead between them (booked, lost, archived).
 */
export function settleLeads(qc: QueryClient, ids: readonly string[], opts: { lists: boolean }) {
  void qc.invalidateQueries({ queryKey: ['crm'], refetchType: 'none' })
  const now = (queryKey: QueryKey) => void qc.invalidateQueries({ queryKey })
  for (const id of ids) {
    now(oneKey(id))
    now(['crm', 'timeline', id])
  }
  now(['crm', 'leads', 'summary'])
  // Queues read the follow-up, quality and owner; they only refetch if open.
  now(['crm', 'call-queue'])
  now(['crm', 'my-day'])
  now(['crm', 'team-day'])
  now(['crm', 'reminders'])
  if (opts.lists) {
    trimToFirstPage(qc, PAGED)
    for (const queryKey of LIST_KEYS) now(queryKey)
  }
}

/**
 * The lead list's pages (useLeadPages, a hundred at a time). An invalidated
 * infinite query refetches every page it holds, one after another, so each
 * refresh above first cuts it back to its first page: one request, not six
 * for someone who pressed Show more five times. The board's columns
 * (useLeadColumns) are one request already; a column's Show more cards are
 * dropped when it refetches.
 */
const PAGED: QueryKey = ['crm', 'leads', 'card', 'pages']

/** Every CRM read asked for again (a set-up change, many leads at once), the list's pages from the first. */
export function refreshCrm(qc: QueryClient) {
  trimToFirstPage(qc, PAGED)
  return qc.invalidateQueries({ queryKey: ['crm'] })
}
