import type { ModuleKey } from '@ipc/permissions'

/**
 * The three-step setup a new studio is walked through, one step at a time:
 * add your team, add your first client, create your first project.
 *
 * Each step is decided by real data. Whether setup as a whole is over is also
 * stored on the studio (setup_done_at / setup_skipped_at, 0191), so once it is
 * finished or skipped it never comes back, even if the studio is emptied out.
 *
 * Everything else a studio does (booking, data, payments, tracking) is in the
 * menu; it is not part of setup.
 */
export type JourneyStepKey = 'team' | 'client' | 'project'

/**
 * Counts from the endpoints the dashboard already queries. `teammates`
 * EXCLUDES the signed-in owner: registration creates them, so counting the
 * whole directory would tick "add your team" off before anyone is added.
 */
export interface StudioSignals {
  teammates: number
  clients: number
  projects: number
}

export type JourneyStepState = 'done' | 'current' | 'upcoming'

export interface JourneyStepDef {
  key: JourneyStepKey
  title: string
  /** One line: why this step matters. */
  why: string
  /**
   * Where the step's button goes. `search` opens the page already doing the
   * thing — "add your team" lands on "how do you want to add them?".
   */
  action: { label: string; to: string; search: Record<string, string> }
  /** Step is hidden from anyone whose access does not include this module. */
  module: ModuleKey
  isDone: (s: StudioSignals) => boolean
}

export interface JourneyStep extends JourneyStepDef {
  /** 1-based position. */
  step: number
  state: JourneyStepState
}

export interface Journey {
  steps: JourneyStep[]
  /** The first step still outstanding, or null when all are done. */
  current: JourneyStep | null
  completed: number
  total: number
  allDone: boolean
}

export const JOURNEY_STEPS: JourneyStepDef[] = [
  {
    key: 'team',
    title: 'Add your team',
    why: 'The people who shoot and edit with you.',
    action: { label: 'Add your team', to: '/employees', search: { add: 'choose', from: 'setup' } },
    module: 'team_directory',
    isDone: (s) => s.teammates > 0,
  },
  {
    key: 'client',
    title: 'Add your first client',
    why: 'The couple or family you are shooting for.',
    action: { label: 'Add a client', to: '/clients', search: { add: '1', from: 'setup' } },
    module: 'clients',
    isDone: (s) => s.clients > 0,
  },
  {
    key: 'project',
    title: 'Create your first project',
    why: 'The shoot, its dates and its price, all in one place.',
    action: { label: 'Create a project', to: '/projects/new', search: { from: 'setup' } },
    module: 'projects',
    isDone: (s) => s.projects > 0,
  },
]

export const SETUP_TOTAL = JOURNEY_STEPS.length

/**
 * Resolve each step against the studio's real state.
 *
 * `current` is the first step still outstanding — NOT the one after the last
 * finished step — so a studio that added a client before a teammate is sent
 * back to the teammate rather than told to redo the client.
 */
export function buildJourney(
  signals: StudioSignals,
  canSee: (module: ModuleKey) => boolean = () => true,
): Journey {
  const visible = JOURNEY_STEPS.filter((s) => canSee(s.module))
  const currentKey = visible.find((s) => !s.isDone(signals))?.key

  const steps: JourneyStep[] = visible.map((def, i) => ({
    ...def,
    step: i + 1,
    state: def.isDone(signals) ? 'done' : def.key === currentKey ? 'current' : 'upcoming',
  }))

  const completed = steps.filter((s) => s.state === 'done').length
  return {
    steps,
    current: steps.find((s) => s.state === 'current') ?? null,
    completed,
    total: steps.length,
    allDone: completed === steps.length,
  }
}

/** The step (1-based) whose page this is, from its path. */
export function stepForPath(pathname: string): (JourneyStepDef & { step: number }) | null {
  const clean = pathname.replace(/\/+$/, '') || '/'
  const i = JOURNEY_STEPS.findIndex((s) => s.action.to === clean)
  return i < 0 ? null : { ...JOURNEY_STEPS[i]!, step: i + 1 }
}

/** The step after this one, or null after the last. */
export function nextStep(key: JourneyStepKey): (JourneyStepDef & { step: number }) | null {
  const i = JOURNEY_STEPS.findIndex((s) => s.key === key)
  const next = JOURNEY_STEPS[i + 1]
  return i < 0 || !next ? null : { ...next, step: i + 2 }
}

/** Only the people standing a studio up are walked through setup. */
export function isSetupAudience(s: { is_owner: boolean; role: string }): boolean {
  return s.is_owner || s.role === 'super_admin' || s.role === 'admin'
}

/**
 * Where someone lands on sign-in: the current setup step's page while their
 * studio is still being set up, otherwise null (the caller's default).
 */
export function setupLanding(
  s: { is_owner: boolean; role: string; setup_done: boolean; setup_step: number | null } | null,
): { to: string; search: Record<string, string> } | null {
  if (!s || s.setup_done || !isSetupAudience(s) || s.setup_step == null) return null
  const def = JOURNEY_STEPS[s.setup_step - 1]
  return def ? { to: def.action.to, search: def.action.search } : null
}
