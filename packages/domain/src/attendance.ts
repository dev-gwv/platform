/**
 * The attendance day roster: what counts as present, and who a filter keeps.
 *
 * This lived in `apps/web` while the API narrowed the same roster with its own
 * copy of the rule. Two implementations of "has this person checked out yet"
 * is one more than can be kept in agreement — and they only have to disagree
 * once for a row to carry a badge that contradicts the filter that found it.
 * Both sides import this now.
 *
 * The recorded status says what happened at the door; whether someone is
 * still inside is a question about the two timestamps. Deriving it rather
 * than storing a fourth status means it can never disagree with the times
 * shown beside it.
 */
export type DisplayStatus = 'present' | 'late' | 'half_day' | 'absent' | 'not_checked_out' | 'on_leave' | 'day_off'

/** The row shape this needs — the API's query result satisfies it too. */
export interface RosterRow {
  status: string
  check_in_at: string | null
  check_out_at: string | null
  engagement_type?: string | null
  name?: string | null
  email?: string | null
  phone?: string | null
  /** On approved leave that day. */
  on_leave?: boolean
  /** A holiday's name or 'Weekly off': nobody was expected in. */
  day_off?: string | null
}

/**
 * Someone who came in is present (or still inside) whatever else the day
 * was; someone who did not, on approved leave or a day off, was never
 * expected -- they are not absent.
 */
export function displayStatus(row: RosterRow): DisplayStatus {
  if (row.check_in_at && !row.check_out_at) return 'not_checked_out'
  if (!row.check_in_at && row.on_leave) return 'on_leave'
  if (!row.check_in_at && row.day_off) return 'day_off'
  return row.status as DisplayStatus
}

/** Expected in that day: not on leave and not a day off (unless they came in anyway). */
const expected = (r: RosterRow) => r.check_in_at !== null || (!r.on_leave && !r.day_off)

export interface RosterFilters {
  /** '' or 'all' means every status. */
  status?: string | undefined
  /** Engagement: '', 'in_house' or 'freelancer'. */
  type?: string | undefined
}

/**
 * Whether one person belongs in the filtered roster.
 *
 * A status filter matches either the derived status or the stored one, so
 * asking for "late" still finds someone who came in late and has not checked
 * out — they are late, whatever the badge on the row currently reads.
 */
export function matchesRoster(row: RosterRow, f: RosterFilters): boolean {
  const wantStatus = f.status && f.status !== 'all' ? f.status : null
  if (wantStatus && displayStatus(row) !== wantStatus && row.status !== wantStatus) return false
  if (f.type && row.engagement_type !== f.type) return false
  return true
}

export interface AttendanceSummary {
  total: number
  present: number
  absent: number
  notCheckedOut: number
  /** Away on approved leave (not counted as absent). */
  onLeave: number
  /** Whole percent of the team that turned up at all. */
  percent: number
}

/**
 * Anyone who came in counts as present for the percentage — late is still
 * turning up, and someone who has not checked out has certainly arrived.
 */
export function summariseRoster(rows: readonly RosterRow[]): AttendanceSummary {
  // The percentage is of the people expected in: leave and days off are not
  // missing, so they neither count against it nor as absent.
  const due = rows.filter(expected)
  const total = due.length
  const turnedUp = rows.filter((r) => r.check_in_at !== null).length
  return {
    total,
    present: turnedUp,
    absent: due.filter((r) => r.check_in_at === null).length,
    notCheckedOut: rows.filter((r) => displayStatus(r) === 'not_checked_out').length,
    onLeave: rows.filter((r) => displayStatus(r) === 'on_leave').length,
    // An empty roster is 0%, not a division by zero dressed up as NaN.
    percent: total === 0 ? 0 : Math.round((turnedUp / total) * 100),
  }
}

// `RosterRow` is deliberately structural rather than an import of the
// contract type: this package stays free of that dependency, and both the
// API's query result and the contract's row satisfy the shape as they are.

// ── the month register (0224) ──────────────────────────────────────

/**
 * One letter per person per day, the way a muster roll reads:
 * P present · L late · H half day · A absent · S on a shoot · Lv leave ·
 * ½Lv half-day leave · Off weekly off · Hol holiday · blank: not tracked yet
 * (before attendance went on, a future day, or today before the sweep).
 */
export type DayCode = 'P' | 'L' | 'H' | 'A' | 'S' | 'Lv' | '½Lv' | 'Off' | 'Hol' | ''

export interface RegisterDay {
  day: string
  status: string | null
  source: string | null
  day_off: string | null
  leave: 'full' | 'half' | null
  leave_unpaid: boolean
  shoot: boolean
}

export interface RegisterContext {
  today: string
  /** The first day the studio tracked; null when attendance is off. */
  trackedFrom: string | null
  /** 0 = lateness never costs pay. */
  lateMarksPerHalfDay?: number
}

const tracked = (day: string, ctx: RegisterContext) => !!ctx.trackedFrom && day >= ctx.trackedFrom && day <= ctx.today

export function dayCode(d: RegisterDay, ctx: RegisterContext): DayCode {
  const offCode: DayCode = d.day_off === 'Weekly off' ? 'Off' : 'Hol'
  if (d.status && tracked(d.day, ctx)) {
    if (d.status === 'half_day') return 'H'
    if (d.status === 'present' || d.status === 'late') return d.source === 'shoot' ? 'S' : d.status === 'late' ? 'L' : 'P'
    // An absent row on a day nobody was due in is not an absence.
    if (d.leave === 'full') return 'Lv'
    if (d.leave === 'half') return '½Lv'
    if (d.shoot) return 'S'
    if (d.day_off) return offCode
    return 'A'
  }
  if (d.day_off) return offCode
  if (!tracked(d.day, ctx)) return ''
  if (d.leave === 'full') return 'Lv'
  if (d.leave === 'half') return '½Lv'
  if (d.shoot) return 'S'
  return ''
}

export interface RegisterTotals {
  present: number
  late: number
  half: number
  absent: number
  /** Days of leave, a half day counting 0.5. */
  leave: number
  workingDays: number
  /** Working days less what payroll cuts: absent, half of each half day, unpaid leave, late marks. */
  payable: number
}

/** The same arithmetic payroll_generate does, so the register and the payslip agree. */
export function registerTotals(days: readonly RegisterDay[], ctx: RegisterContext): RegisterTotals {
  let present = 0
  let late = 0
  let half = 0
  let absent = 0
  let leave = 0
  let unpaid = 0
  let working = 0
  for (const d of days) {
    if (!d.day_off) working++
    const code = dayCode(d, ctx)
    if (code === 'P' || code === 'L' || code === 'S') present++
    if (code === 'L') late++
    if (code === 'H') half++
    if (code === 'A') absent++
    if (code === 'Lv' || code === '½Lv') {
      const n = code === 'Lv' ? 1 : 0.5
      leave += n
      if (d.leave_unpaid && !d.day_off) unpaid += n
    }
  }
  const marks = ctx.lateMarksPerHalfDay ?? 0
  const latePenalty = marks > 0 ? Math.floor(late / marks) * 0.5 : 0
  return {
    present,
    late,
    half,
    absent,
    leave,
    workingDays: working,
    payable: Math.max(0, working - absent - half * 0.5 - unpaid - latePenalty),
  }
}
