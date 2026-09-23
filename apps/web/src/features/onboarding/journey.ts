import type { ModuleKey } from '@ipc/permissions'

/**
 * The studio-setup journey shown on the dashboard until a new studio is running.
 *
 * Every step is decided by real data, never by a "dismissed" flag — the card
 * reflects what the studio actually has, so it cannot congratulate someone for
 * work they have not done, and it comes back if a studio is emptied out.
 */
export type JourneyStepKey =
  'team' | 'client' | 'project' | 'booking' | 'data' | 'payment' | 'tracking'

/**
 * Counts pulled from the endpoints the dashboard already queries. `teammates`
 * EXCLUDES the signed-in owner: registration creates them, so counting the
 * whole directory would tick "set up your team" off before anyone is added.
 */
export interface StudioSignals {
  teammates: number
  clients: number
  projects: number
  bookings: number
  dataRecords: number
  invoices: number
  trackedTasks: number
}

export type JourneyStepState = 'done' | 'current' | 'upcoming'

export interface JourneyStepDef {
  key: JourneyStepKey
  title: string
  description: string
  /**
   * Where the step's button goes. `search` lets a step open a page already
   * doing the thing it asks for — "set up your team" lands on "how do you
   * want to add them?", not on a list of nobody with filters above it.
   */
  action: { label: string; to: string; search?: Record<string, string> }
  /** Step is hidden from anyone whose access does not include this module. */
  module: ModuleKey
  isDone: (s: StudioSignals) => boolean
}

export interface JourneyStep extends JourneyStepDef {
  /** 1-based position among the steps this user can actually see. */
  step: number
  state: JourneyStepState
}

export interface Journey {
  steps: JourneyStep[]
  completed: number
  total: number
  allDone: boolean
}

export const JOURNEY_STEPS: JourneyStepDef[] = [
  {
    key: 'team',
    title: 'Set up your team',
    description:
      'Add your photographers, editors, managers, and team members. Then prepare their access and roles.',
    action: { label: 'Add your team', to: '/employees', search: { add: 'choose', from: 'setup' } },
    module: 'team_directory',
    isDone: (s) => s.teammates > 0,
  },
  {
    key: 'client',
    title: 'Add your first client',
    description: 'Create the client record before starting a booked project.',
    action: { label: 'Add a client', to: '/clients', search: { add: '1', from: 'setup' } },
    module: 'clients',
    isDone: (s) => s.clients > 0,
  },
  {
    key: 'project',
    title: 'Create your first project',
    description: 'Add project details, shoots, deliverables, billing, and final review.',
    action: { label: 'Create Project', to: '/projects/new', search: { from: 'setup' } },
    module: 'projects',
    isDone: (s) => s.projects > 0,
  },
  {
    key: 'booking',
    title: 'Book team for shoots',
    description: 'Assign your team members to the right shoots.',
    action: { label: 'Team Booking', to: '/team-allocation', search: { from: 'setup' } },
    module: 'projects',
    isDone: (s) => s.bookings > 0,
  },
  {
    key: 'data',
    title: 'Track data and backup',
    description: 'Track shooter data, primary copy, and backup status shoot by shoot.',
    action: { label: 'Data Management', to: '/data-management', search: { from: 'setup' } },
    module: 'projects',
    isDone: (s) => s.dataRecords > 0,
  },
  {
    key: 'payment',
    title: 'Track payments / invoices',
    description: 'Track received payments, pending dues, invoices, and client billing.',
    action: { label: 'Payments', to: '/billing', search: { from: 'setup' } },
    module: 'billing',
    isDone: (s) => s.invoices > 0,
  },
  {
    key: 'tracking',
    title: 'Track project health',
    description:
      'Check completion, blockers, overdue work, missing data, and recommended next action.',
    action: { label: 'Project Tracking', to: '/projects', search: { from: 'setup' } },
    module: 'tasks',
    // Health is read off tasks, so the step lands once there is work to read.
    isDone: (s) => s.trackedTasks > 0,
  },
]

/**
 * Resolve each step against the studio's real state.
 *
 * `current` is the first step still outstanding — NOT simply the one after the
 * last completed step, so a studio that added a client before a teammate still
 * gets pointed back at the teammate rather than being told to redo the client.
 * A finished step is never "upcoming", whatever order it was finished in.
 */
export function buildJourney(
  signals: StudioSignals,
  canSee: (module: ModuleKey) => boolean = () => true,
): Journey {
  const visible = JOURNEY_STEPS.filter((s) => canSee(s.module))
  const currentKey = visible.find((s) => !s.isDone(signals))?.key

  const steps = visible.map((def, i) => ({
    ...def,
    step: i + 1,
    state: (def.isDone(signals)
      ? 'done'
      : def.key === currentKey
        ? 'current'
        : 'upcoming') as JourneyStepState,
  }))

  const completed = steps.filter((s) => s.state === 'done').length
  return { steps, completed, total: steps.length, allDone: completed === steps.length }
}
