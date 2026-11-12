import type { GettingStarted } from '@ipc/contracts'
import { JOURNEY_STEPS, type StudioSignals } from './journey'
import { SETUP_VIDEOS, type SetupVideoStep } from './setup-videos'

/**
 * "Set up Studio AutoPilot, step by step" on a new studio's Home (owner,
 * 12 Nov: "it can take them step by step ... they do not need a demo video").
 * The same six steps as /start, each ticked by what the studio has really done
 * -- never a box someone must tick -- with its video and the place to do it.
 */
export const SETUP_VIDEO_DAYS = 60

export interface SetupProgressStep {
  step: SetupVideoStep
  /** 1-based, the same number as on /start. */
  n: number
  done: boolean
}

type Facts = StudioSignals & Pick<GettingStarted, 'quotation' | 'logo'>

export function setupProgress(f: Facts): SetupProgressStep[] {
  const done: Record<string, boolean> = {
    account: true,
    team: f.teammates > 0,
    client: f.clients > 0,
    project: f.projects > 0,
    quotation: f.quotation,
    studio: f.logo,
  }
  return SETUP_VIDEOS.map((step, i) => ({ step, n: i + 1, done: !!done[step.key] }))
}

/** The one to do now: the first open required step, then the optional one. */
export function nextSetupStep(steps: readonly SetupProgressStep[]): SetupProgressStep | null {
  return steps.find((s) => !s.done && !s.step.optional) ?? steps.find((s) => !s.done) ?? null
}

/**
 * Up while the studio is new (60 days from setup closing, or from its start),
 * until every required step is done or this person puts it away. The optional
 * last step never keeps it up: Getting started carries the logo after it.
 */
export function showSetupProgress(
  steps: readonly SetupProgressStep[],
  startedAt: string,
  closed: boolean,
  now = new Date(),
): boolean {
  if (closed) return false
  const t = Date.parse(startedAt)
  if (!Number.isNaN(t) && now.getTime() - t > SETUP_VIDEO_DAYS * 86_400_000) return false
  return steps.some((s) => !s.done && !s.step.optional)
}

/** "2 of 6 done" -- moves the moment a step's data lands. */
export function setupCountLine(steps: readonly SetupProgressStep[]): string {
  return `${steps.filter((s) => s.done).length} of ${steps.length} done`
}

/**
 * Where "Do this now" goes. While setup is still open, the first three steps
 * go the way setup does (`?from=setup`), so the page keeps its step bar and
 * moves on to the next step by itself once its job is done.
 */
export function setupStepTarget(step: SetupVideoStep, setupOpen: boolean): { to: string; search?: Record<string, string> } {
  const journey = setupOpen ? JOURNEY_STEPS.find((j) => j.key === step.key) : undefined
  if (journey) return { to: journey.action.to, search: journey.action.search }
  return step.action.search ? { to: step.action.to, search: step.action.search } : { to: step.action.to }
}
