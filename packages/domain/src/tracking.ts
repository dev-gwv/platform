/**
 * Project health.
 *
 * The tracking page answers one question for a studio owner on a Monday: which
 * project needs me today? That means turning a pile of counters into a single
 * ordering, and — more usefully — into the one action that would move each
 * project forward.
 *
 * The rules live here rather than in SQL or a component so they can be argued
 * with in tests. The API supplies counts; nothing in this file touches a clock
 * except through the `today` argument, so the same input always scores the same.
 */

/** Raw counters for one project, as the API returns them. */
export interface ProjectCounters {
  status: 'active' | 'completed' | 'cancelled' | 'on_hold'
  tasks_total: number
  tasks_done: number
  tasks_overdue: number
  /** Dropped deliverables are left out: they are no longer owed. */
  deliverables_total: number
  deliverables_done: number
  /** Open deliverables past their due date. */
  deliverables_late?: number
  /** Shoot-linked data records only — loose records aren't a custody risk. */
  data_records_total: number
  /** Records not yet in two places (with the shooter, received, or copied once). */
  data_records_unverified: number
  /** Booked crew whose shoot day has passed, who owe data and handed in none. */
  data_missing?: number
  /** Records with a problem on either copy. */
  data_issues?: number
  pending_reviews: number
  /** Upcoming shoots with fewer people booked than the roles need. */
  shoots_short?: number
  /** Sent invoices past their due date with money still owed. */
  invoices_overdue?: number
  shoots_total: number
  shoots_done: number
  /** Earliest upcoming shoot, or null when nothing is scheduled ahead. */
  next_shoot_date: string | null
  last_activity_at: string
}

export type RiskBand = 'critical' | 'high' | 'low_progress' | 'healthy' | 'completed'

export type NextActionKey =
  | 'secure_data'
  | 'clear_overdue'
  | 'review_submissions'
  | 'staff_shoot'
  | 'chase_payment'
  | 'plan_work'
  | 'schedule_shoot'
  | 'deliver'
  | 'keep_going'
  | 'none'

export interface ProjectHealth {
  /** 0–1. Tasks and deliverables count equally; both are work owed. */
  completion: number
  band: RiskBand
  /** Higher is more urgent. Only meaningful relative to other projects. */
  score: number
  /** Why it scored: the flags the filter tabs are built from. */
  flags: {
    critical: boolean
    high_risk: boolean
    low_progress: boolean
    data_missing: boolean
    overdue: boolean
    pending_review: boolean
    completed: boolean
  }
  next_action: NextActionKey
  /** Why it needs attention, most important first; each has the action that fixes it. */
  reasons: Reason[]
}

export type ReasonCode = 'data' | 'late' | 'review' | 'short_crew' | 'invoice_overdue' | 'low_progress' | 'no_work' | 'no_shoot'

export interface Reason {
  code: ReasonCode
  /** How many things are behind it (0 when it is a yes/no). */
  count: number
  action: NextActionKey
}

/** Every piece of footage not yet safe: never handed in, not in two places, or with a problem. */
export const dataProblemsOf = (c: ProjectCounters) => c.data_records_unverified + (c.data_missing ?? 0) + (c.data_issues ?? 0)

/**
 * Completion counts tasks and deliverables together: a project with every task
 * ticked but nothing delivered is not done, and the reverse is just as untrue.
 * With nothing to count at all, completion is 0 — an empty project has made no
 * progress, rather than being finished.
 */
export function completionOf(c: ProjectCounters): number {
  const total = c.tasks_total + c.deliverables_total
  if (total === 0) return 0
  return (c.tasks_done + c.deliverables_done) / total
}

/** Days between two ISO dates, positive when `then` is in the past. */
function daysSince(then: string, today: string): number {
  const a = Date.parse(then)
  const b = Date.parse(today)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.floor((b - a) / 86_400_000)
}

/**
 * The single action worth taking next, in the order a studio would take them.
 *
 * Unverified footage outranks everything: an overdue edit costs a deadline, a
 * missing card costs the shoot. After custody comes work that is already late,
 * then work waiting on someone else, then work that hasn't been planned at all.
 */
/** Late work of either kind: an overdue task or a deliverable past its date. */
export const lateOf = (c: ProjectCounters) => c.tasks_overdue + (c.deliverables_late ?? 0)

/**
 * Why a project needs attention, in the one order the whole app uses: footage
 * first (a missing card costs the shoot), then late work, work waiting on us,
 * a shoot short of crew, money overdue, and last whether the work is planned.
 * The next action is simply the first reason's action.
 */
export function reasonsFor(c: ProjectCounters, completion: number): Reason[] {
  if (c.status === 'cancelled') return []
  const out: Reason[] = []
  const data = dataProblemsOf(c)
  if (data > 0) out.push({ code: 'data', count: data, action: 'secure_data' })
  if (lateOf(c) > 0) out.push({ code: 'late', count: lateOf(c), action: 'clear_overdue' })
  if (c.pending_reviews > 0) out.push({ code: 'review', count: c.pending_reviews, action: 'review_submissions' })
  if (c.status === 'completed') return out
  if ((c.shoots_short ?? 0) > 0) out.push({ code: 'short_crew', count: c.shoots_short ?? 0, action: 'staff_shoot' })
  if ((c.invoices_overdue ?? 0) > 0) out.push({ code: 'invoice_overdue', count: c.invoices_overdue ?? 0, action: 'chase_payment' })
  const owed = c.tasks_total + c.deliverables_total
  const shootingDone = c.shoots_total > 0 && c.shoots_done === c.shoots_total
  if (owed > 0 && completion < 1 && shootingDone && completion < LOW_PROGRESS) {
    out.push({ code: 'low_progress', count: 0, action: 'keep_going' })
  }
  if (owed === 0) out.push({ code: 'no_work', count: 0, action: 'plan_work' })
  if (c.shoots_total === 0) out.push({ code: 'no_shoot', count: 0, action: 'schedule_shoot' })
  return out
}

export function nextActionFor(c: ProjectCounters, completion: number): NextActionKey {
  if (c.status === 'cancelled') return 'none'
  const first = reasonsFor(c, completion).find((r) => r.code !== 'low_progress')
  if (first && (c.status !== 'completed' || ['data', 'late', 'review'].includes(first.code))) {
    // Before the project is planned, schedule the shoot first, then say what is owed.
    if (first.code === 'no_work' && c.shoots_total === 0) return 'schedule_shoot'
    return first.action
  }
  if (c.status === 'completed') return 'none'
  if (completion >= 1 && c.tasks_total + c.deliverables_total > 0) return 'deliver'
  return 'keep_going'
}

/**
 * How loudly a project is asking for attention.
 *
 * The weights are deliberately coarse — this orders a list, it does not grade
 * anyone. Overdue work and unverified data dominate because both are already
 * costing the studio; low completion after the shooting is done matters, but
 * only once there is nothing left to shoot.
 */
export function scoreOf(c: ProjectCounters, completion: number, today: string): number {
  if (c.status === 'cancelled') return 0
  if (c.status === 'completed') return 0

  const shootingDone = c.shoots_total > 0 && c.shoots_done === c.shoots_total
  const stale = Math.min(daysSince(c.last_activity_at, today), 60)

  return (
    dataProblemsOf(c) * 12 +
    lateOf(c) * 10 +
    c.pending_reviews * 4 +
    (c.shoots_short ?? 0) * 6 +
    (c.invoices_overdue ?? 0) * 5 +
    (shootingDone ? (1 - completion) * 30 : 0) +
    (c.status === 'on_hold' ? 8 : 0) +
    stale / 6
  )
}

/** The threshold at which a project reads as "deal with this today". */
const CRITICAL_SCORE = 30
const HIGH_SCORE = 12
const LOW_PROGRESS = 0.35

export function projectHealth(c: ProjectCounters, today: string): ProjectHealth {
  const completion = completionOf(c)
  const shootingDone = c.shoots_total > 0 && c.shoots_done === c.shoots_total
  // Finished is finished, whatever the status column still says: a project with
  // every task and deliverable ticked is not asking for anything.
  const done = c.status === 'completed' || (completion >= 1 && c.tasks_total + c.deliverables_total > 0)
  const score = done ? 0 : scoreOf(c, completion, today)

  // Late work and unverified footage are risks by their nature, not by their
  // arithmetic — one overdue task is worth flagging even though it scores below
  // the threshold on its own.
  const urgent = dataProblemsOf(c) > 0 || lateOf(c) > 0

  const flags = {
    critical: !done && score >= CRITICAL_SCORE,
    high_risk: !done && score < CRITICAL_SCORE && (score >= HIGH_SCORE || urgent),
    low_progress: !done && shootingDone && completion < LOW_PROGRESS,
    data_missing: dataProblemsOf(c) > 0,
    overdue: lateOf(c) > 0,
    pending_review: c.pending_reviews > 0,
    completed: done,
  }

  const band: RiskBand = done
    ? 'completed'
    : flags.critical
      ? 'critical'
      : flags.high_risk
        ? 'high'
        : flags.low_progress
          ? 'low_progress'
          : 'healthy'

  return { completion, band, score, flags, next_action: nextActionFor(c, completion), reasons: reasonsFor(c, completion) }
}
