import { projectHealth, type NextActionKey, type ProjectHealth, type ReasonCode } from '@ipc/domain'
import type { ProjectTrackingRow } from '@ipc/contracts'

/**
 * The tracking board's filtering and ordering.
 *
 * Health scoring lives in @ipc/domain; this only decides which bucket a scored
 * project falls into and how the list is arranged. Both stay pure so the tabs'
 * counts and the list can never disagree — they are computed from the same
 * array in the same pass.
 */
export type TrackingTab = 'all' | 'attention' | 'overdue' | 'data_missing' | 'pending_review' | 'on_track' | 'completed'

/**
 * Six questions, each answered in projects: "which need me?", "where is work
 * late?", "whose footage isn't safe yet?", "who has handed in work?", "which
 * are fine?", "which are done?".
 */
export const TRACKING_TABS: ReadonlyArray<{ value: TrackingTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'overdue', label: 'Late work' },
  { value: 'data_missing', label: 'Data not safe' },
  { value: 'pending_review', label: 'Work to review' },
  { value: 'on_track', label: 'On track' },
  { value: 'completed', label: 'Done' },
]

export type TrackingSort = 'risk' | 'next_shoot' | 'next_due' | 'late' | 'completion' | 'name'

export const TRACKING_SORTS: ReadonlyArray<{ value: TrackingSort; label: string }> = [
  { value: 'risk', label: 'Most urgent first' },
  { value: 'next_due', label: 'Next delivery due' },
  { value: 'next_shoot', label: 'Next shoot first' },
  { value: 'late', label: 'Most late work' },
  { value: 'completion', label: 'Least done first' },
  { value: 'name', label: 'Name (A–Z)' },
]

type Row = Omit<ProjectTrackingRow, 'health'> & { health?: ProjectTrackingRow['health'] }

/** A row with its verdict attached, which is what the page renders. */
export interface TrackedProject extends Omit<ProjectTrackingRow, 'health'> {
  health: ProjectHealth
}

/**
 * The server sends each row's health (one answer for every screen). A row
 * without one -- the preview, a test -- is scored here with the same rules.
 */
export function track(rows: readonly Row[], today: string): TrackedProject[] {
  return rows.map((row) => ({
    ...row,
    health: (row.health as ProjectHealth | undefined) ?? projectHealth(row, today),
  }))
}

/** Project or client name. */
export function matchesSearch(p: Pick<TrackedProject, 'name' | 'client_name'>, q: string): boolean {
  const needle = q.trim().toLowerCase()
  return !needle || p.name.toLowerCase().includes(needle) || (p.client_name ?? '').toLowerCase().includes(needle)
}

export function matchesTab(p: TrackedProject, tab: TrackingTab): boolean {
  const f = p.health.flags
  switch (tab) {
    case 'all':
      return true
    case 'attention':
      return f.critical || f.high_risk || f.low_progress
    case 'overdue':
      return f.overdue
    case 'data_missing':
      return f.data_missing
    case 'pending_review':
      return f.pending_review
    case 'on_track':
      return p.health.band === 'healthy'
    case 'completed':
      return f.completed
  }
}

/** Count per tab, so a tab reading 0 is never hiding something. */
export function tabCounts(projects: readonly TrackedProject[]): Record<TrackingTab, number> {
  const counts = {} as Record<TrackingTab, number>
  for (const { value } of TRACKING_TABS) {
    counts[value] = projects.filter((p) => matchesTab(p, value)).length
  }
  return counts
}

const byName = (a: TrackedProject, b: TrackedProject) => a.name.localeCompare(b.name)

const SORTS: Record<TrackingSort, (a: TrackedProject, b: TrackedProject) => number> = {
  risk: (a, b) => b.health.score - a.health.score || byName(a, b),
  completion: (a, b) => a.health.completion - b.health.completion || byName(a, b),
  // A project with no shoot booked has no date to sort by; it sinks rather than
  // sorting as "soonest".
  next_shoot: (a, b) => {
    if (a.next_shoot_date === b.next_shoot_date) return byName(a, b)
    if (!a.next_shoot_date) return 1
    if (!b.next_shoot_date) return -1
    return a.next_shoot_date.localeCompare(b.next_shoot_date)
  },
  next_due: (a, b) => {
    if (a.next_due_date === b.next_due_date) return byName(a, b)
    if (!a.next_due_date) return 1
    if (!b.next_due_date) return -1
    return a.next_due_date.localeCompare(b.next_due_date)
  },
  late: (a, b) =>
    b.tasks_overdue + b.deliverables_late - (a.tasks_overdue + a.deliverables_late) || b.health.score - a.health.score || byName(a, b),
  name: byName,
}

export function filterAndSort(
  projects: readonly TrackedProject[],
  tab: TrackingTab,
  sort: TrackingSort,
): TrackedProject[] {
  return projects.filter((p) => matchesTab(p, tab)).sort(SORTS[sort])
}

/** The project to put at the top of the page, or null on a quiet board. */
export function mostUrgent(projects: readonly TrackedProject[]): TrackedProject | null {
  const ranked = [...projects]
    .filter((p) => p.health.score > 0)
    .sort((a, b) => b.health.score - a.health.score)
  return ranked[0] ?? null
}

/** The tiles across the top: the same counts as the tabs, so a tile and its tab always agree. */
export function summary(projects: readonly TrackedProject[]) {
  const c = tabCounts(projects)
  return { attention: c.attention, overdue: c.overdue, data_missing: c.data_missing, pending_review: c.pending_review }
}

/** What the recommended action reads as on screen. */
/** Where the next action is done: the project tab that fixes it. */
export const NEXT_ACTION_TAB: Record<NextActionKey, string | null> = {
  secure_data: 'shoots',
  clear_overdue: 'deliverables',
  review_submissions: 'completed_work',
  plan_work: 'deliverables',
  schedule_shoot: 'shoots',
  staff_shoot: 'shoots',
  chase_payment: 'billing',
  deliver: 'deliverables',
  keep_going: null,
  none: null,
}

export const NEXT_ACTION_LABEL: Record<NextActionKey, string> = {
  secure_data: 'Back up and verify the shoot data',
  clear_overdue: 'Catch up on the late work',
  review_submissions: 'Review the submitted work',
  plan_work: 'Add what you owe the client',
  schedule_shoot: 'Schedule the first shoot',
  staff_shoot: 'Book crew for the next shoot',
  chase_payment: 'Follow up the overdue invoice',
  deliver: 'Deliver and close the project',
  keep_going: 'On track — keep going',
  none: 'Nothing to do',
}

export const BAND_LABEL = {
  critical: 'Critical',
  high: 'High risk',
  low_progress: 'Low progress',
  healthy: 'On track',
  completed: 'Completed',
} as const

export const BAND_TONE = {
  critical: 'danger',
  high: 'warning',
  low_progress: 'warning',
  healthy: 'success',
  completed: 'neutral',
} as const

/** The chip for each reason, worded with its count. */
export function reasonLabel(code: ReasonCode, n: number): string {
  const s = (one: string, many: string) => (n === 1 ? one : many)
  switch (code) {
    case 'data':
      return `${n} ${s('card', 'cards')} of data not safe`
    case 'late':
      return `${n} late`
    case 'review':
      return `${n} to review`
    case 'short_crew':
      return `${n} ${s('shoot', 'shoots')} short of crew`
    case 'invoice_overdue':
      return `${n} ${s('invoice', 'invoices')} overdue`
    case 'low_progress':
      return 'Shooting done, little delivered'
    case 'no_work':
      return 'Nothing to deliver added yet'
    case 'no_shoot':
      return 'No shoot scheduled'
  }
}

export const REASON_TONE: Record<ReasonCode, 'danger' | 'warning' | 'info' | 'neutral'> = {
  data: 'danger',
  late: 'danger',
  review: 'warning',
  short_crew: 'warning',
  invoice_overdue: 'warning',
  low_progress: 'info',
  no_work: 'neutral',
  no_shoot: 'neutral',
}
