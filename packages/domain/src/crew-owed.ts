import { roundINR } from './money'

/**
 * Crew money by when the shoot is. A booking is owed once its shoot day has
 * passed (India's date); before that it is a promise. Money paid before the
 * shoot is "paid in advance", never subtracted from what is owed for shoots
 * already done.
 */
export interface CrewPayoutLine {
  user_id: string
  user_name: string | null
  /** The shoot's day, YYYY-MM-DD in India. */
  shoot_date: string
  /** What the booking pays. */
  amount: number
  /** Signed total paid toward it (reversals already subtracted). */
  paid: number
}

export type CrewBucket = 'past' | 'upcoming'

/** Owed once the day has passed: a shoot today is still upcoming. */
export function crewBucketOf(shootDate: string, today: string): CrewBucket {
  return shootDate < today ? 'past' : 'upcoming'
}

export function lineBalance(l: Pick<CrewPayoutLine, 'amount' | 'paid'>): number {
  return Math.max(0, l.amount - l.paid)
}

export interface CrewOwedPerson {
  user_id: string
  user_name: string | null
  owed: number
  /** Shoots already done that still have money left on them. */
  bookings: number
}

export interface CrewOwedSummary {
  /** Shoots already done, minus what has been paid toward them. */
  owed_now: number
  /** What future shoots will pay, less anything paid ahead. */
  upcoming: number
  /** Everything paid, on any booking. */
  paid: number
  /** Paid toward shoots that have not happened yet. */
  paid_ahead: number
  /** Everyone with something owed now, most owed first. */
  people: CrewOwedPerson[]
}

export function summarizeCrewOwed(lines: readonly CrewPayoutLine[], today: string): CrewOwedSummary {
  let owedNow = 0
  let upcoming = 0
  let paid = 0
  let paidAhead = 0
  const byPerson = new Map<string, CrewOwedPerson>()
  for (const l of lines) {
    paid += l.paid
    const left = lineBalance(l)
    if (crewBucketOf(l.shoot_date, today) === 'past') {
      if (left <= 0.001) continue
      owedNow += left
      const p = byPerson.get(l.user_id) ?? { user_id: l.user_id, user_name: l.user_name, owed: 0, bookings: 0 }
      p.owed += left
      p.bookings += 1
      byPerson.set(l.user_id, p)
    } else {
      upcoming += left
      if (l.paid > 0) paidAhead += l.paid
    }
  }
  const people = [...byPerson.values()]
    .map((p) => ({ ...p, owed: roundINR(p.owed) }))
    .sort((a, b) => b.owed - a.owed || (a.user_name ?? '').localeCompare(b.user_name ?? ''))
  return {
    owed_now: roundINR(owedNow),
    upcoming: roundINR(upcoming),
    paid: roundINR(paid),
    paid_ahead: roundINR(paidAhead),
    people,
  }
}

export interface CrewMonthPerson {
  user_id: string
  user_name: string | null
  /** The month's done shoots with money still left on them. */
  shoots: number
  /** What those shoots pay. */
  owed: number
  /** Paid toward them. */
  paid: number
  /** Still owed for them: the month's share of Owed now. */
  due: number
  /** What the month's shoots still to come will pay, less anything paid ahead. */
  upcoming: number
}

/**
 * Payroll's "Shoot payouts for <month>": the same lines and the same rule as
 * Team payouts' Owed now (summarizeCrewOwed), narrowed to shoots in the month
 * (`from`..`to`, YYYY-MM-DD). Shoots still to come are kept apart in
 * `upcoming`, never added to what is owed.
 */
export function crewMonthDue(lines: readonly CrewPayoutLine[], from: string, to: string, today: string): CrewMonthPerson[] {
  const byPerson = new Map<string, CrewMonthPerson>()
  for (const l of lines) {
    if (l.shoot_date < from || l.shoot_date > to) continue
    const left = lineBalance(l)
    if (left <= 0.001) continue
    const p = byPerson.get(l.user_id) ?? { user_id: l.user_id, user_name: l.user_name, shoots: 0, owed: 0, paid: 0, due: 0, upcoming: 0 }
    if (crewBucketOf(l.shoot_date, today) === 'past') {
      p.shoots += 1
      p.owed += l.amount
      p.paid += l.paid
      p.due += left
    } else {
      p.upcoming += left
    }
    byPerson.set(l.user_id, p)
  }
  return [...byPerson.values()]
    .map((p) => ({ ...p, owed: roundINR(p.owed), paid: roundINR(p.paid), due: roundINR(p.due), upcoming: roundINR(p.upcoming) }))
    .sort((a, b) => (a.user_name ?? '').localeCompare(b.user_name ?? ''))
}

// ── Team payouts' views, worked out where the rows are ─────────────────
// They used to run in the browser over every booking the studio ever made
// (3 MB on a studio with 7,500 bookings, speed check 22 Nov); the server now
// runs the same functions and sends one page. The browser still runs them
// for the CSV.

/** Team payouts' views: what is owed now, what is promised, everything, by project. */
export type CrewView = 'owed' | 'upcoming' | 'all' | 'projects'

/** A booking's line with what the views read beyond the money. */
export interface CrewViewLine extends CrewPayoutLine {
  project_id: string | null
  project_name: string | null
  /** False for a released or cancelled booking kept only for its payments. */
  stands: boolean
}

export interface CrewFilters {
  project?: string | undefined
  /** A person's name, any part of it. */
  q?: string | undefined
  from?: string | undefined
  to?: string | undefined
}

/** The rows a view shows: Owed now is shoots already done with money left on them. */
export function crewRowsFor<T extends CrewViewLine>(rows: readonly T[], view: CrewView, today: string, f: CrewFilters = {}): T[] {
  const q = f.q?.trim().toLowerCase() ?? ''
  return rows.filter((r) => {
    const bucket = crewBucketOf(r.shoot_date, today)
    if (view === 'owed' && (bucket !== 'past' || lineBalance(r) <= 0.001)) return false
    if (view === 'upcoming' && bucket !== 'upcoming') return false
    // 'projects' and 'all' keep every row; the filters below still apply.
    if (f.project && r.project_id !== f.project) return false
    if (f.from && r.shoot_date < f.from) return false
    if (f.to && r.shoot_date > f.to) return false
    if (q && !(r.user_name ?? '').toLowerCase().includes(q)) return false
    return true
  })
}

export interface ProjectCrewMoney {
  project_id: string | null
  project_name: string
  /** Every standing booking's payout. */
  booked: number
  paid: number
  /** Shoots already done, minus what is paid on them. */
  owed: number
  /** Promised for shoots still to come, minus anything paid ahead. */
  upcoming: number
  people: number
  /** Bookings with no payout set yet. */
  unset: number
  last_shoot: string
}

/**
 * One line per project: what its crew was promised, what has gone out, what
 * is owed now and what is still to come. Each rupee once, by the same rule as
 * Owed now (a released booking counts only what was paid on it).
 */
export function crewByProject(rows: readonly CrewViewLine[], today: string): ProjectCrewMoney[] {
  const by = new Map<string, ProjectCrewMoney & { _people: Set<string> }>()
  for (const r of rows) {
    const key = r.project_id ?? 'none'
    const m =
      by.get(key) ??
      ({ project_id: r.project_id, project_name: r.project_name ?? 'No project', booked: 0, paid: 0, owed: 0, upcoming: 0, people: 0, unset: 0, last_shoot: r.shoot_date, _people: new Set<string>() } as ProjectCrewMoney & { _people: Set<string> })
    m.paid += r.paid
    if (r.stands) {
      m.booked += r.amount
      if (r.amount <= 0) m.unset += 1
      const left = lineBalance(r)
      if (crewBucketOf(r.shoot_date, today) === 'past') m.owed += left
      else m.upcoming += left
    }
    m._people.add(r.user_id)
    if (r.shoot_date > m.last_shoot) m.last_shoot = r.shoot_date
    by.set(key, m)
  }
  return [...by.values()]
    .map(({ _people, ...m }) => ({ ...m, people: _people.size }))
    .sort((a, b) => b.owed - a.owed || b.last_shoot.localeCompare(a.last_shoot))
}

/** A person's header figures on Team payouts, over every row of theirs a view shows. */
export interface CrewPersonTotals {
  user_id: string
  user_name: string | null
  /** Shoots already done, minus what is paid on them. */
  owed: number
  /** Still to pay for shoots to come. */
  ahead: number
  /** How many shoots to come still have money to go. */
  ahead_shoots: number
  shoots: number
}

/** Each person's totals, in the order they first appear in `rows`. */
export function crewPersonTotals(rows: readonly CrewPayoutLine[], today: string): CrewPersonTotals[] {
  const by = new Map<string, CrewPersonTotals>()
  for (const r of rows) {
    const p = by.get(r.user_id) ?? { user_id: r.user_id, user_name: r.user_name, owed: 0, ahead: 0, ahead_shoots: 0, shoots: 0 }
    const bal = lineBalance(r)
    if (crewBucketOf(r.shoot_date, today) === 'past') p.owed += bal
    else if (bal > 0.001) {
      p.ahead += bal
      p.ahead_shoots += 1
    }
    p.shoots += 1
    by.set(r.user_id, p)
  }
  return [...by.values()]
}
