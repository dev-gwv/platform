import type { MyDeliverable } from '@ipc/contracts'
import { daysUntil, todayInIndia } from '@/shared/ui/days-left'
import { stageOf } from './deliverable-stage'

/**
 * An editor's list, cut into what to do first: what came back for changes,
 * what is late, what is due this week, the rest, what is waiting on a
 * reviewer, and what was delivered lately.
 */
export type WorkSection = 'changes' | 'late' | 'week' | 'later' | 'review' | 'done'

export const SECTION_ORDER: readonly WorkSection[] = ['changes', 'late', 'week', 'later', 'review', 'done']

export const SECTION_LABEL: Record<WorkSection, string> = {
  changes: 'Changes asked',
  late: 'Late',
  week: 'This week',
  later: 'Later',
  review: 'Waiting for review',
  done: 'Done lately',
}

type Row = Pick<MyDeliverable, 'status' | 'estimated_date' | 'changes_requested'>

export function sectionOf(d: Row, today = todayInIndia()): WorkSection {
  const s = stageOf(d.status)
  if (s === 'completed' || s === 'cancelled') return 'done'
  if (d.changes_requested) return 'changes'
  if (s === 'review') return 'review'
  if (!d.estimated_date) return 'later'
  const days = daysUntil(d.estimated_date, today)
  if (days < 0) return 'late'
  if (days <= 6) return 'week'
  return 'later'
}

export function bySection<T extends Row>(rows: readonly T[], today = todayInIndia()): { section: WorkSection; rows: T[] }[] {
  return SECTION_ORDER.map((section) => ({ section, rows: rows.filter((r) => sectionOf(r, today) === section) })).filter(
    (g) => g.rows.length > 0,
  )
}

/** "3 edits · 1 late", said once above the list. */
export function workSentence(rows: readonly Row[], today = todayInIndia()): string {
  const open = rows.filter((r) => sectionOf(r, today) !== 'done')
  if (open.length === 0) return 'Nothing to edit right now.'
  const late = open.filter((r) => sectionOf(r, today) === 'late').length
  const changes = open.filter((r) => sectionOf(r, today) === 'changes').length
  const parts = [`${open.length} ${open.length === 1 ? 'edit' : 'edits'}`]
  if (changes) parts.push(`${changes} sent back`)
  if (late) parts.push(`${late} late`)
  return parts.join(' · ')
}

/** Shoots whose data is not in yet, by name: "Waiting for Haldi data". */
export function waitingFor(shoots: readonly { name: string; data_ready: boolean }[]): string | null {
  const missing = shoots.filter((s) => !s.data_ready).map((s) => s.name)
  if (shoots.length === 0 || missing.length === 0) return null
  return `Waiting for ${missing.join(', ')} data`
}
