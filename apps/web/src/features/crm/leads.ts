import type { CrmLead, LeadQuality, LeadStatus } from '@ipc/contracts'
import { LEGACY_STAGES, LEGACY_STAGE_LABEL } from '@ipc/domain'

/**
 * The follow-up desk's arithmetic.
 *
 * Every number and chip on the CRM page comes from here, computed in one pass
 * over the same array, so the summary strip and the filtered list can never
 * disagree. Nothing reads the clock directly — `now` is always passed in — so
 * the same leads always bucket the same way in a test.
 */

/** Where a lead sits relative to its promised call-back. */
export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'none'

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export function dueBucket(lead: CrmLead, now: Date): DueBucket {
  // A closed lead owes nobody a call, whatever date is still on it.
  if (lead.status === 'converted' || lead.status === 'lost') return 'none'
  if (!lead.follow_up_at) return 'none'
  const due = new Date(lead.follow_up_at)
  if (Number.isNaN(due.getTime())) return 'none'
  const today = startOfDay(now)
  const dueDay = startOfDay(due)
  if (dueDay < today) return 'overdue'
  if (dueDay.getTime() === today.getTime()) return 'today'
  // Tomorrow earns its own column: the point of the board is to know what to
  // prepare for tonight, and "upcoming" buries that among next month's.
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  if (dueDay.getTime() === tomorrow.getTime()) return 'tomorrow'
  return 'upcoming'
}

export const isOpen = (l: CrmLead): boolean => l.status !== 'converted' && l.status !== 'lost'

/** Never contacted: still in 'new' and nothing stamped a conversation. */
export const isUncontacted = (l: CrmLead): boolean =>
  l.status === 'new' && l.last_contacted_at === null

/** An open lead with no promised call-back — the quiet way a deal dies. */
export const hasNoFollowUp = (l: CrmLead): boolean => isOpen(l) && l.follow_up_at === null

export function wonThisMonth(l: CrmLead, now: Date): boolean {
  if (l.status !== 'converted' || !l.converted_at) return false
  const at = new Date(l.converted_at)
  return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth()
}

interface LeadSummary {
  total: number
  uncontacted: number
  today: number
  overdue: number
  hot: number
  wonThisMonth: number
}

/** The strip across the top. `total` counts open leads — the working set. */
export function summarise(leads: readonly CrmLead[], now: Date): LeadSummary {
  return {
    total: leads.filter(isOpen).length,
    uncontacted: leads.filter(isUncontacted).length,
    today: leads.filter((l) => dueBucket(l, now) === 'today').length,
    overdue: leads.filter((l) => dueBucket(l, now) === 'overdue').length,
    hot: leads.filter((l) => l.is_hot && isOpen(l)).length,
    wonThisMonth: leads.filter((l) => wonThisMonth(l, now)).length,
  }
}

export type QuickFilter =
  | 'due_today'
  | 'overdue'
  | 'hot'
  | 'uncontacted'
  | 'proposal_sent'
  | 'unassigned'
  | 'no_follow_up'

export const QUICK_FILTERS: ReadonlyArray<{ value: QuickFilter; label: string }> = [
  { value: 'due_today', label: 'Due today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'hot', label: 'Hot' },
  { value: 'uncontacted', label: 'Uncontacted' },
  { value: 'proposal_sent', label: 'Proposal sent' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'no_follow_up', label: 'No follow-up' },
]

const PREDICATES: Record<QuickFilter, (l: CrmLead, now: Date) => boolean> = {
  due_today: (l, now) => dueBucket(l, now) === 'today',
  overdue: (l, now) => dueBucket(l, now) === 'overdue',
  hot: (l) => l.is_hot && isOpen(l),
  uncontacted: (l) => isUncontacted(l),
  proposal_sent: (l) => l.status === 'proposal_sent',
  unassigned: (l) => l.assigned_to === null && isOpen(l),
  no_follow_up: (l) => hasNoFollowUp(l),
}

export function countsFor(
  leads: readonly CrmLead[],
  now: Date,
): Record<QuickFilter, number> {
  const counts = {} as Record<QuickFilter, number>
  for (const { value } of QUICK_FILTERS) {
    counts[value] = leads.filter((l) => PREDICATES[value]!(l, now)).length
  }
  return counts
}

export interface LeadQuery {
  search: string
  /** Chips are additive: a lead must satisfy every one that is on. */
  filters: readonly QuickFilter[]
  status: LeadStatus | 'all'
  assignee: string | 'all'
  /**
   * Hot / warm / cold. The Hot chip only ever matched the binary is_hot flag,
   * so there was no way to ask for warm leads — or to exclude cold ones —
   * even though every lead carries a three-state quality.
   */
  quality: LeadQuality | 'all'
  /**
   * One tag, by id, or 'all'.
   *
   * Replaces the free-text `group_name`, which had a server filter nobody sent
   * and no UI at all — so a studio could label forty leads and never get those
   * forty back (0197).
   */
  tag: string | 'all'
  /**
   * When the lead arrived. The server has taken date_created / date_from /
   * date_to since 0013 and no UI ever offered any of them, so "the leads that
   * came in this month" was a question the CRM could answer and could not be
   * asked.
   */
  created: 'all' | 'today' | 'last7' | 'this_month'
}

export const EMPTY_QUERY: LeadQuery = {
  search: '',
  filters: [],
  status: 'all',
  assignee: 'all',
  quality: 'all',
  tag: 'all',
  created: 'all',
}

function matchesSearch(l: CrmLead, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [l.name, l.phone, l.email, l.assignee_name, l.notes]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle))
}

/**
 * Chips narrow rather than widen. Two chips mean "both", which is what a person
 * reaching for "Hot" and "Overdue" together is asking for — the leads that are
 * hot AND late, not a longer list than either.
 */
/** The period labels, so the filter and the chip that describes it agree. */
export const CREATED_RANGES: ReadonlyArray<{ value: LeadQuery['created']; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: 'today', label: 'Arrived today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'this_month', label: 'This month' },
]

function arrivedWithin(l: CrmLead, range: LeadQuery['created'], now: Date): boolean {
  if (range === 'all') return true
  const at = new Date(l.created_at)
  if (Number.isNaN(at.getTime())) return false
  if (range === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return at >= start
  }
  if (range === 'last7') {
    const start = new Date(now)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    return at >= start
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return at >= start
}

export function applyQuery(
  leads: readonly CrmLead[],
  query: LeadQuery,
  now: Date,
): CrmLead[] {
  return leads
    .filter((l) => query.filters.every((f) => PREDICATES[f]!(l, now)))
    .filter((l) => (query.status === 'all' ? true : l.status === query.status))
    .filter((l) => (query.quality === 'all' ? true : l.quality === query.quality))
    .filter((l) => (query.tag === 'all' ? true : l.tags.some((t) => t.id === query.tag)))
    .filter((l) => arrivedWithin(l, query.created, now))
    .filter((l) =>
      query.assignee === 'all'
        ? true
        : query.assignee === 'none'
          ? l.assigned_to === null
          : l.assigned_to === query.assignee,
    )
    .filter((l) => matchesSearch(l, query.search))
    .sort(byUrgency(now))
}

/**
 * Late first, then due today, then everything else — and hot before cold at
 * every level. The desk works top-down, so the order is the priority.
 */
function byUrgency(now: Date) {
  const rank = (l: CrmLead): number => {
    const bucket = dueBucket(l, now)
    if (bucket === 'overdue') return 0
    if (bucket === 'today') return 1
    if (isUncontacted(l)) return 2
    if (bucket === 'upcoming') return 3
    return 4
  }
  return (a: CrmLead, b: CrmLead): number => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    if (a.is_hot !== b.is_hot) return a.is_hot ? -1 : 1
    // Within a bucket, the one waiting longest goes first.
    const aDue = a.follow_up_at ?? a.created_at
    const bDue = b.follow_up_at ?? b.created_at
    return aDue.localeCompare(bDue)
  }
}

/**
 * The six statuses every filter and report is keyed on. A studio's own
 * pipeline stages (usePipelines) derive one of these; the list itself lives
 * in @ipc/domain so nothing on this page can spell it differently.
 */
export const STAGES: ReadonlyArray<{ key: LeadStatus; label: string }> = LEGACY_STAGES
export const STAGE_LABEL: Record<LeadStatus, string> = LEGACY_STAGE_LABEL

/** Board columns for the follow-up view — by when, not by stage. */
export const DUE_COLUMNS: ReadonlyArray<{ key: DueBucket; label: string; hint: string }> = [
  { key: 'overdue', label: 'Overdue', hint: 'Promised earlier and missed' },
  { key: 'today', label: 'Today', hint: 'Due before the day ends' },
  { key: 'tomorrow', label: 'Tomorrow', hint: 'Prepare for these tonight' },
  { key: 'upcoming', label: 'Upcoming', hint: 'Scheduled ahead, earliest first' },
  { key: 'none', label: 'No follow-up', hint: 'Nobody has agreed to call back' },
]

/** Group open leads by due bucket, each column already in working order. */
export function boardColumns(
  leads: readonly CrmLead[],
  now: Date,
): Record<DueBucket, CrmLead[]> {
  const columns: Record<DueBucket, CrmLead[]> = { overdue: [], today: [], tomorrow: [], upcoming: [], none: [] }
  for (const lead of leads) {
    if (!isOpen(lead)) continue
    columns[dueBucket(lead, now)].push(lead)
  }
  for (const key of Object.keys(columns) as DueBucket[]) columns[key].sort(byUrgency(now))
  return columns
}
