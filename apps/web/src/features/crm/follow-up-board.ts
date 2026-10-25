import type { CrmActivity } from '@ipc/contracts'
import { followUpBucket, type FollowUpBucket } from './follow-ups'

/**
 * The follow-up board (owner, 25 Oct: "a very great follow-up board where we
 * can just check all the leads and filter accordingly"): every open
 * follow-up in columns by when it is owed, narrowed by person, type, priority
 * and a search. Pure, so the filters and the sentence are tested.
 */

export type BoardColumnKey = FollowUpBucket | 'undated'

export const BOARD_COLUMNS: ReadonlyArray<{ key: BoardColumnKey; label: string }> = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'undated', label: 'No time set' },
]

export type BoardFilters = {
  people: string[]
  types: string[]
  priorities: string[]
  search: string
}

export const NO_FILTERS: BoardFilters = { people: [], types: [], priorities: [], search: '' }

/** The key a follow-up with nobody, no type or no priority is filtered under. */
export const NONE = '__none__'

const lower = (s: string | null | undefined) => (s ?? '').toLowerCase()

export function activeFilterCount(f: BoardFilters): number {
  return f.people.length + f.types.length + f.priorities.length + (f.search.trim() ? 1 : 0)
}

/** Keep the follow-ups that pass every filter in use. */
export function filterFollowUps(tasks: readonly CrmActivity[], f: BoardFilters): CrmActivity[] {
  const words = f.search.trim().toLowerCase()
  const digits = words.replace(/\D/g, '')
  const has = (list: string[], v: string | null | undefined) =>
    !list.length || list.some((x) => (x === NONE ? !v : lower(x) === lower(v)))
  return tasks.filter((t) => {
    if (!has(f.people, t.whose_id)) return false
    if (!has(f.types, t.subject)) return false
    if (!has(f.priorities, t.priority)) return false
    if (!words) return true
    if (digits.length >= 4 && (t.lead_phone ?? '').replace(/\D/g, '').includes(digits)) return true
    return [t.lead_name, t.subject, t.body, t.whose_name].some((x) => lower(x).includes(words))
  })
}

/** Each column's follow-ups, soonest first; the undated last. */
export function boardColumns(tasks: readonly CrmActivity[], now: Date = new Date()): Record<BoardColumnKey, CrmActivity[]> {
  const out: Record<BoardColumnKey, CrmActivity[]> = { overdue: [], today: [], tomorrow: [], week: [], later: [], undated: [] }
  for (const t of tasks) out[t.due_at ? followUpBucket(t.due_at, now) : 'undated'].push(t)
  for (const k of Object.keys(out) as BoardColumnKey[]) {
    out[k].sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))
  }
  return out
}

/** "4 overdue · 6 today · 9 more this week", or the calm version. */
export function boardSentence(cols: Record<BoardColumnKey, CrmActivity[]>): string {
  const n = (k: BoardColumnKey) => cols[k].length
  const parts = [
    n('overdue') ? `${n('overdue')} overdue` : null,
    n('today') ? `${n('today')} today` : null,
    n('tomorrow') + n('week') ? `${n('tomorrow') + n('week')} more this week` : null,
  ].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  const rest = n('later') + n('undated')
  return rest ? `Nothing due this week · ${rest} later` : 'No follow-ups waiting'
}

/** The people on the board, each with how many they have, most first, nobody last. */
export function peopleOn(tasks: readonly CrmActivity[]): Array<{ id: string; name: string; count: number }> {
  const m = new Map<string, { id: string; name: string; count: number }>()
  for (const t of tasks) {
    const id = t.whose_id ?? NONE
    const row = m.get(id) ?? { id, name: t.whose_name ?? 'Nobody', count: 0 }
    row.count += 1
    m.set(id, row)
  }
  return [...m.values()].sort(
    (a, b) => Number(a.id === NONE) - Number(b.id === NONE) || b.count - a.count || a.name.localeCompare(b.name),
  )
}
