import type { Deliverable, DeliverableStatus } from '@ipc/contracts'
import type { Tone } from '@/features/data/stage'

/**
 * Where a deliverable stands, in the studio's words.
 *
 * Four steps -- To do, Editing, Review, Delivered -- and, inside them, the
 * studio's own named stages (see ./stages.ts); plus Dropped, for something
 * the client no longer wants. "Late" is not a
 * stage; it is a due date that has passed on work not yet delivered, and it
 * shows on the date, where the eye already is.
 */

/** The path a deliverable walks, in order. Dropped sits outside it. */
export const STAGE_ORDER = ['pending', 'in_progress', 'review', 'completed'] as const satisfies readonly DeliverableStatus[]

export const STAGE_LABEL: Record<DeliverableStatus, string> = {
  pending: 'To do',
  in_progress: 'Editing',
  review: 'Review',
  completed: 'Delivered',
  cancelled: 'Dropped',
}

export const STAGE_TONE: Record<DeliverableStatus, Tone> = {
  pending: 'neutral',
  in_progress: 'info',
  review: 'warning',
  completed: 'success',
  cancelled: 'neutral',
}

/** The words on the one button that moves it forward. */
export const NEXT_ACTION: Partial<Record<DeliverableStatus, string>> = {
  pending: 'Start editing',
  in_progress: 'Sent to client',
  review: 'Mark delivered',
}

/** A stored status as one of ours; anything unknown reads as To do. */
export function stageOf(status: string): DeliverableStatus {
  return (status in STAGE_LABEL ? status : 'pending') as DeliverableStatus
}

export function nextStage(status: string): DeliverableStatus | null {
  const i = STAGE_ORDER.indexOf(stageOf(status) as (typeof STAGE_ORDER)[number])
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1]! : null
}

export function previousStage(status: string): DeliverableStatus | null {
  const i = STAGE_ORDER.indexOf(stageOf(status) as (typeof STAGE_ORDER)[number])
  return i > 0 ? STAGE_ORDER[i - 1]! : null
}

/** Moving into these asks for the link that went to the client. */
export const wantsLink = (s: DeliverableStatus) => s === 'review' || s === 'completed'

const isOpen = (status: string) => !['completed', 'cancelled'].includes(stageOf(status))

type Dated = { status: string; estimated_date?: string | null | undefined }

/** Today as YYYY-MM-DD in local time. */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export function isLate(d: Dated, today = todayIso()): boolean {
  return !!d.estimated_date && isOpen(d.status) && d.estimated_date < today
}

const dayMs = 86_400_000
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs)
const short = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** "Due 12 Oct", "Due today", "3 days late", "Delivered 10 Oct", or null when there is nothing to say. */
export function dueLabel(
  d: Dated & { delivered_at?: string | null | undefined },
  today = todayIso(),
): string | null {
  const s = stageOf(d.status)
  if (s === 'completed') return d.delivered_at ? `Delivered ${short(d.delivered_at.slice(0, 10))}` : null
  if (s === 'cancelled' || !d.estimated_date) return null
  const diff = daysBetween(today, d.estimated_date)
  if (diff === 0) return 'Due today'
  if (diff < 0) return diff === -1 ? '1 day late' : `${-diff} days late`
  return `Due ${short(d.estimated_date)}`
}

/**
 * The due date as a person says it: "Due tomorrow", "Due in 12 days",
 * "3 days late", "Delivered 10 Sept". The card leads with this; the exact
 * date sits in its tooltip.
 */
export function relativeDue(
  d: Dated & { delivered_at?: string | null | undefined },
  today = todayIso(),
): string | null {
  const s = stageOf(d.status)
  if (s === 'completed') return d.delivered_at ? `Delivered ${short(d.delivered_at.slice(0, 10))}` : 'Delivered'
  if (s === 'cancelled' || !d.estimated_date) return null
  const diff = daysBetween(today, d.estimated_date)
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  if (diff < 0) return diff === -1 ? '1 day late' : `${-diff} days late`
  return `Due in ${diff} days`
}

/** Days until due (negative when late), or null when there is no open date. */
export function daysToDue(d: Dated, today = todayIso()): number | null {
  if (!d.estimated_date || !isOpen(d.status)) return null
  return daysBetween(today, d.estimated_date)
}

export interface ShootRef {
  id: string
  name: string
  shoot_date?: string | null | undefined
}

export interface DeliverableGroup {
  /** null for the whole-project group. */
  shoot: ShootRef | null
  items: Deliverable[]
}

/**
 * One group per shoot, in shoot-date order, then the whole project. Shoots
 * with nothing yet still get a group, so there is somewhere to add the first.
 * A deliverable whose shoot has gone lands with the whole project.
 */
export function groupByShoot(deliverables: readonly Deliverable[], shoots: readonly ShootRef[]): DeliverableGroup[] {
  const ordered = [...shoots].sort(
    (a, b) => (a.shoot_date ?? '9999').localeCompare(b.shoot_date ?? '9999') || a.name.localeCompare(b.name),
  )
  const known = new Set(ordered.map((s) => s.id))
  const groups: DeliverableGroup[] = ordered.map((shoot) => ({
    shoot,
    items: deliverables.filter((d) => d.shoot_id === shoot.id),
  }))
  groups.push({ shoot: null, items: deliverables.filter((d) => !d.shoot_id || !known.has(d.shoot_id)) })
  return groups
}

/** Delivered out of all that count (dropped ones don't), and how many are late. */
export function deliverableCounts(deliverables: readonly Dated[], today = todayIso()) {
  const live = deliverables.filter((d) => stageOf(d.status) !== 'cancelled')
  return {
    total: live.length,
    delivered: live.filter((d) => stageOf(d.status) === 'completed').length,
    late: live.filter((d) => isLate(d, today)).length,
  }
}
