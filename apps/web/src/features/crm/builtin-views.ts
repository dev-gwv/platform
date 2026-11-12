import type { LeadRow, SavedViewQuery } from '@ipc/contracts'
import { EMPTY_QUERY, applyQuery, dueBucket, isOpen, type QuickFilter } from './leads'
import { toLeadQuery } from './views'

/**
 * The views a studio actually works from, as the only thing on screen.
 *
 * The CRM used to put four counters, a checklist, two filter bars and a tab
 * strip above the first lead. Every one of those numbers is really the size of
 * a list — so the number goes in the name of the view, and the list is what
 * you get when you pick it. Nothing is shown that you did not ask for, and no
 * figure appears without the rows that explain it.
 *
 * Each built-in reuses a predicate from `leads.ts` rather than restating it,
 * so a view and the chip it came from can never disagree.
 */
export type BuiltinViewKey =
  | 'today'
  | 'overdue'
  | 'uncontacted'
  | 'no_follow_up'
  | 'hot'
  | 'all'

interface BuiltinView {
  key: BuiltinViewKey
  name: string
  /** Said under the name when the picker is open; never on the page itself. */
  hint: string
  /** The chip this view is built from, when it is exactly one. */
  filter?: QuickFilter
}

export const BUILTIN_VIEWS: readonly BuiltinView[] = [
  { key: 'today', name: 'Today', hint: 'Late, and owed before the day ends' },
  { key: 'overdue', name: 'Overdue', hint: 'Promised earlier and missed', filter: 'overdue' },
  { key: 'uncontacted', name: 'Uncontacted', hint: 'Nobody has rung them yet', filter: 'uncontacted' },
  { key: 'no_follow_up', name: 'No follow-up', hint: 'Nobody agreed to call back', filter: 'no_follow_up' },
  { key: 'hot', name: 'Hot', hint: 'Ready to book', filter: 'hot' },
  { key: 'all', name: 'All leads', hint: 'Everything still open' },
]

/**
 * Today is the one view that is not a single chip: it is what you owe now,
 * which is the late ones and the ones due before the day ends, together. A
 * studio clearing its morning does not think of those as two lists.
 */
export function inView<T extends LeadRow>(leads: readonly T[], key: BuiltinViewKey, now: Date): T[] {
  if (key === 'all') return leads.filter(isOpen)
  if (key === 'today') {
    return leads.filter((l) => {
      const b = dueBucket(l, now)
      return b === 'overdue' || b === 'today'
    })
  }
  const view = BUILTIN_VIEWS.find((v) => v.key === key)
  if (!view?.filter) return leads.filter(isOpen)
  return applyQuery(leads, { ...EMPTY_QUERY, filters: [view.filter] }, now)
}

/** The number beside each name. Zero is shown as nothing, not as "0". */
export function viewCounts(leads: readonly LeadRow[], now: Date): Record<BuiltinViewKey, number> {
  const out = {} as Record<BuiltinViewKey, number>
  for (const v of BUILTIN_VIEWS) out[v.key] = inView(leads, v.key, now).length
  return out
}

/** The view a studio should land on: the work owed, unless there is none. */
export function openingView(leads: readonly LeadRow[], now: Date): BuiltinViewKey {
  if (inView(leads, 'today', now).length > 0) return 'today'
  if (inView(leads, 'uncontacted', now).length > 0) return 'uncontacted'
  return 'all'
}

export const viewName = (key: BuiltinViewKey): string =>
  BUILTIN_VIEWS.find((v) => v.key === key)?.name ?? 'All leads'

/**
 * Which closed leads a list view needs beyond the open ones, or null for none.
 *
 * Every built-in view is about leads still being worked, so the page loads
 * open leads only. A saved view can ask for a status: booked ('won'), lost,
 * or any status at all ('all', which keeps closed leads in the list, as it
 * always did). Only then is the wider read made.
 */
export function closedOutcomeFor(
  current: { kind: 'builtin' } | { kind: 'saved'; id: string },
  saved: readonly { id: string; query: SavedViewQuery }[],
): 'won' | 'lost' | 'all' | null {
  if (current.kind !== 'saved') return null
  const v = saved.find((x) => x.id === current.id)
  if (!v) return null
  const q = toLeadQuery(v.query)
  if (q.status === 'converted') return 'won'
  if (q.status === 'lost') return 'lost'
  // Every quick filter (hot, overdue, unassigned…) only ever matches an open
  // lead, so a view with one needs nothing closed.
  if (q.status === 'all' && q.filters.length === 0) return 'all'
  return null
}
