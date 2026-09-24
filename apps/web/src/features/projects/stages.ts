import type { DeliverableStage, DeliverableStatus, StepKey } from '@ipc/contracts'
import { STAGE_LABEL, STAGE_ORDER, stageOf } from './deliverable-stage'

/**
 * Where a deliverable stands, in the studio's own words.
 *
 * Every deliverable is on one of four steps -- To do, Editing, Review,
 * Delivered -- which tracking, quotations and the pipeline count. Inside a step
 * a studio may name its own stages ("With manager", "Approved", "With client",
 * "Colour grading"); a deliverable carries the step as `status` and the named
 * stage as `custom_status_code`. This module turns the pair into a name, a
 * colour, and the next place the one-tap button should take it.
 */

export type StageTone = 'slate' | 'blue' | 'violet' | 'amber' | 'green' | 'rose' | 'teal'

export const TONE_CLASSES: Record<StageTone, { solid: string; soft: string; text: string; border: string; ring: string }> = {
  slate: { solid: 'bg-slate-400 dark:bg-slate-500', soft: 'bg-muted', text: 'text-muted-foreground', border: 'border-l-slate-300 dark:border-l-slate-600', ring: 'ring-slate-300' },
  blue: { solid: 'bg-tone-blue', soft: 'bg-tone-blue-soft', text: 'text-tone-blue', border: 'border-l-tone-blue', ring: 'ring-tone-blue/30' },
  violet: { solid: 'bg-tone-violet', soft: 'bg-tone-violet-soft', text: 'text-tone-violet', border: 'border-l-tone-violet', ring: 'ring-tone-violet/30' },
  amber: { solid: 'bg-tone-amber', soft: 'bg-tone-amber-soft', text: 'text-tone-amber', border: 'border-l-tone-amber', ring: 'ring-tone-amber/30' },
  green: { solid: 'bg-tone-green', soft: 'bg-tone-green-soft', text: 'text-tone-green', border: 'border-l-tone-green', ring: 'ring-tone-green/30' },
  rose: { solid: 'bg-tone-rose', soft: 'bg-tone-rose-soft', text: 'text-tone-rose', border: 'border-l-tone-rose', ring: 'ring-tone-rose/30' },
  teal: { solid: 'bg-tone-teal', soft: 'bg-tone-teal-soft', text: 'text-tone-teal', border: 'border-l-tone-teal', ring: 'ring-tone-teal/30' },
}

export const TONES = Object.keys(TONE_CLASSES) as StageTone[]

/** Each step's own colour, when no named stage says otherwise. */
export const STEP_TONE: Record<DeliverableStatus, StageTone> = {
  pending: 'slate',
  in_progress: 'blue',
  review: 'amber',
  completed: 'green',
  cancelled: 'slate',
}

/** The step names. "Review" covers everything between the edit and the delivery. */
export const STEP_LABEL: Record<StepKey, string> = {
  pending: 'To do',
  in_progress: 'Editing',
  review: 'Review',
  completed: 'Delivered',
}

/** Colours saved by older versions of the app, read as the nearest of ours. */
const LEGACY_TONE: Record<string, StageTone> = {
  emerald: 'green', sky: 'blue', indigo: 'violet', orange: 'amber', pink: 'rose', gray: 'slate', grey: 'slate',
}

export function toneOf(color: string | null | undefined, fallback: StageTone = 'slate'): StageTone {
  if (!color) return fallback
  if (color in TONE_CLASSES) return color as StageTone
  return LEGACY_TONE[color] ?? fallback
}

type Placed = { status: string; custom_status_code?: string | null | undefined }

/** A step's named stages, in the studio's order. */
export function stagesIn(stages: readonly DeliverableStage[], step: StepKey): DeliverableStage[] {
  return stages.filter((s) => s.stage === step).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
}

/** The named stage it is on, if it is on one of the studio's. */
export function namedStage(d: Placed, stages: readonly DeliverableStage[]): DeliverableStage | null {
  if (!d.custom_status_code) return null
  const step = stageOf(d.status)
  return stages.find((s) => s.code === d.custom_status_code && s.stage === step) ?? null
}

/** "With manager" when it has a named stage, else the step: "Editing". */
export function stageName(d: Placed, stages: readonly DeliverableStage[]): string {
  const step = stageOf(d.status)
  if (step === 'cancelled') return STAGE_LABEL.cancelled
  return namedStage(d, stages)?.label ?? STEP_LABEL[step]
}

export function stageTone(d: Placed, stages: readonly DeliverableStage[]): StageTone {
  const step = stageOf(d.status)
  const named = namedStage(d, stages)
  return named ? toneOf(named.color, STEP_TONE[step]) : STEP_TONE[step]
}

/** A place a deliverable can be: a step, and optionally a named stage in it. */
export interface StagePoint {
  status: StepKey
  code: string | null
  label: string
  tone: StageTone
  team_allowed: boolean
}

/**
 * Stages that are a step back, not forward: the one-tap button never walks
 * into them. "Changes requested" is where work goes when it is sent back.
 */
const BACKWARD = new Set(['changes_requested'])

/**
 * The road forward, one tap at a time: To do, Editing, then each named stage
 * in order (skipping the ones that mean "sent back"), then Delivered. A step
 * with named stages is walked through them; one without is a single stop.
 */
export function forwardPath(stages: readonly DeliverableStage[]): StagePoint[] {
  const path: StagePoint[] = []
  for (const step of STAGE_ORDER as readonly StepKey[]) {
    const named = stagesIn(stages, step).filter((s) => !BACKWARD.has(s.code))
    const plain: StagePoint = { status: step, code: null, label: STEP_LABEL[step], tone: STEP_TONE[step], team_allowed: true }
    // Editing is always a stop of its own: it is where the work happens.
    // Review with named stages goes straight to the first of them.
    if (step !== 'review' || named.length === 0) path.push(plain)
    for (const s of named) {
      path.push({ status: step, code: s.code, label: s.label, tone: toneOf(s.color, STEP_TONE[step]), team_allowed: s.team_allowed })
    }
  }
  return path
}

/** Where the one-tap button takes it next, or null once it is delivered or dropped. */
export function nextPoint(d: Placed, stages: readonly DeliverableStage[]): StagePoint | null {
  const step = stageOf(d.status)
  if (step === 'cancelled' || step === 'completed') return null
  const path = forwardPath(stages)
  const code = d.custom_status_code ?? null
  let at = path.findIndex((p) => p.status === step && p.code === code)
  // On a stage that is not on the road (sent back, or since removed): carry
  // on from the last stop in the same step, so "Changes requested" goes
  // forward to review again.
  if (at < 0) {
    for (let i = path.length - 1; i >= 0; i--) {
      if (path[i]!.status === step) {
        at = i
        break
      }
    }
  }
  if (at < 0) return null
  return path[at + 1] ?? null
}

/** The words on the one-tap button. */
export function actionLabel(p: StagePoint): string {
  switch (p.code) {
    case 'with_manager':
      return 'Send for review'
    case 'approved':
      return 'Approve'
    case 'with_client':
      return 'Sent to client'
    case 'client_approved':
      return 'Client approved'
  }
  if (p.code) return p.label
  switch (p.status) {
    case 'in_progress':
      return 'Start editing'
    case 'review':
      return 'Send for review'
    case 'completed':
      return 'Mark delivered'
    default:
      return p.label
  }
}

/** Moving here is the moment a link goes out, so it is asked for (and may be left blank). */
export function wantsLinkAt(p: Pick<StagePoint, 'status' | 'code'>): boolean {
  if (p.status === 'completed') return true
  if (p.status !== 'review') return false
  return p.code === null || p.code === 'with_client' || p.code === 'with_manager'
}

/** Everywhere it can be moved to, grouped by step, for the "Move to" list. */
export function allPoints(stages: readonly DeliverableStage[]): { step: StepKey; points: StagePoint[] }[] {
  return (STAGE_ORDER as readonly StepKey[]).map((step) => ({
    step,
    points: [
      { status: step, code: null, label: STEP_LABEL[step], tone: STEP_TONE[step], team_allowed: true },
      ...stagesIn(stages, step).map((s) => ({
        status: step,
        code: s.code,
        label: s.label,
        tone: toneOf(s.color, STEP_TONE[step]),
        team_allowed: s.team_allowed,
      })),
    ],
  }))
}

/** "moved:review:with_client" -> "With client"; older "moved:review" -> "Review". */
export function movedLabel(body: string | null | undefined, stages: readonly DeliverableStage[]): string {
  const [, status = '', code] = (body ?? '').split(':')
  return stageName({ status, custom_status_code: code ?? null }, stages)
}
