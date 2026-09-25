import type { BoardDeliverable, DeliverableStage, StepKey } from '@ipc/contracts'
import { STAGE_ORDER, stageOf, todayIso } from '@/features/projects/deliverable-stage'
import { STEP_LABEL, STEP_TONE, stagesIn, toneOf, type StageTone } from '@/features/projects/stages'

/**
 * The production board's arithmetic, kept out of the components so it can be
 * argued with in tests: which lane a card sits in, which of the four figures
 * it counts towards, and what each person is carrying.
 */

export interface Lane {
  key: string
  status: StepKey
  code: string | null
  label: string
  tone: StageTone
  team_allowed: boolean
}

export const laneKey = (status: string, code: string | null | undefined) => `${status}:${code ?? ''}`

/**
 * One lane per place a deliverable can be, in the studio's order: To do,
 * Editing, each named stage (Changes requested included -- work sent back is
 * work someone must pick up), then Delivered. Review with named stages is
 * walked through them, so a bare "Review" lane appears only when the studio
 * has none.
 */
export function lanesFor(stages: readonly DeliverableStage[]): Lane[] {
  const lanes: Lane[] = []
  for (const step of STAGE_ORDER as readonly StepKey[]) {
    const named = stagesIn(stages, step)
    if (step !== 'review' || named.length === 0) {
      lanes.push({ key: laneKey(step, null), status: step, code: null, label: STEP_LABEL[step], tone: STEP_TONE[step], team_allowed: true })
    }
    for (const s of named) {
      lanes.push({
        key: laneKey(step, s.code),
        status: step,
        code: s.code,
        label: s.label,
        tone: toneOf(s.color, STEP_TONE[step]),
        team_allowed: s.team_allowed,
      })
    }
  }
  return lanes
}

/**
 * The lane a card sits in. A card on a stage the studio has since removed (or
 * never had) sits in its step's own lane, or the step's first lane when the
 * step has no plain lane -- never nowhere. Dropped work has no lane.
 */
export function laneOf(d: Pick<BoardDeliverable, 'status' | 'custom_status_code'>, lanes: readonly Lane[]): Lane | null {
  const step = stageOf(d.status)
  if (step === 'cancelled') return null
  const code = d.custom_status_code ?? null
  return (
    lanes.find((l) => l.status === step && l.code === code) ??
    lanes.find((l) => l.status === step && l.code === null) ??
    lanes.find((l) => l.status === step) ??
    null
  )
}

const isOpen = (d: Pick<BoardDeliverable, 'status'>) => !['completed', 'cancelled'].includes(stageOf(d.status))

/** The four figures above the board; each is also a filter. */
export type Focus = 'late' | 'today' | 'review' | 'unassigned'

export const FOCI: readonly { key: Focus; label: string; help: string }[] = [
  { key: 'late', label: 'Late', help: 'Open work past its due date.' },
  { key: 'today', label: 'Due today', help: 'Open work due today.' },
  { key: 'review', label: 'Waiting on review', help: 'With the manager, approved, or with the client: work someone else must look at.' },
  { key: 'unassigned', label: 'Unassigned', help: 'Open work with no editor on it.' },
]

export function inFocus(d: BoardDeliverable, focus: Focus, today = todayIso()): boolean {
  switch (focus) {
    case 'late':
      return isOpen(d) && !!d.estimated_date && d.estimated_date < today
    case 'today':
      return isOpen(d) && d.estimated_date === today
    case 'review':
      return stageOf(d.status) === 'review'
    case 'unassigned':
      return isOpen(d) && !d.assignee_id
  }
}

export interface BoardFilters {
  project?: string | undefined
  /** A user id, or 'none' for work with no editor. */
  person?: string | undefined
  q?: string | undefined
  focus?: Focus | null | undefined
}

export function applyFilters(items: readonly BoardDeliverable[], f: BoardFilters, today = todayIso()): BoardDeliverable[] {
  const q = (f.q ?? '').trim().toLowerCase()
  return items.filter((d) => {
    if (f.project && d.project_id !== f.project) return false
    if (f.person === 'none' ? !!d.assignee_id : f.person && d.assignee_id !== f.person) return false
    if (f.focus && !inFocus(d, f.focus, today)) return false
    if (q && !`${d.title} ${d.project_name} ${d.client_name ?? ''} ${d.assignee_name ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

/** Counts for the four figures, over what the other filters allow. */
export function focusCounts(items: readonly BoardDeliverable[], today = todayIso()): Record<Focus, number> & { open: number } {
  return {
    open: items.filter(isOpen).length,
    late: items.filter((d) => inFocus(d, 'late', today)).length,
    today: items.filter((d) => inFocus(d, 'today', today)).length,
    review: items.filter((d) => inFocus(d, 'review', today)).length,
    unassigned: items.filter((d) => inFocus(d, 'unassigned', today)).length,
  }
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface PersonLoad {
  open: BoardDeliverable[]
  late: number
  /** Due from today to six days out: this week's promises. */
  dueThisWeek: number
}

/** What one person is carrying: open work soonest due first, late first of all. */
export function personLoad(items: readonly BoardDeliverable[], userId: string | null, today = todayIso()): PersonLoad {
  const weekEnd = addDays(today, 6)
  const open = items
    .filter((d) => isOpen(d) && (d.assignee_id ?? null) === userId)
    .sort((a, b) => (a.estimated_date ?? '9999').localeCompare(b.estimated_date ?? '9999') || a.title.localeCompare(b.title))
  return {
    open,
    late: open.filter((d) => !!d.estimated_date && d.estimated_date < today).length,
    dueThisWeek: open.filter((d) => !!d.estimated_date && d.estimated_date >= today && d.estimated_date <= weekEnd).length,
  }
}

/** Cards in a lane: late first, then soonest due, undated last. Delivered: newest first. */
export function sortInLane(items: readonly BoardDeliverable[], lane: Pick<Lane, 'status'>): BoardDeliverable[] {
  if (lane.status === 'completed') {
    return [...items].sort((a, b) => (b.delivered_at ?? '').localeCompare(a.delivered_at ?? ''))
  }
  return [...items].sort((a, b) => (a.estimated_date ?? '9999').localeCompare(b.estimated_date ?? '9999') || a.title.localeCompare(b.title))
}
