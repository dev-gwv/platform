import type { AttendanceDayRow } from '@ipc/contracts'
import { displayStatus as displayStatusOf, matchesRoster, summariseRoster, type DisplayStatus } from '@ipc/domain'

/**
 * The attendance dashboard's presentation: labels, tones, and the formatting
 * around them.
 *
 * The rules themselves — what counts as present, who a filter keeps — moved
 * to `@ipc/domain` so the API narrows the roster with the same code rather
 * than its own copy. Two implementations of "has this person checked out yet"
 * only have to disagree once for a row to carry a badge that contradicts the
 * filter that found it.
 */
export type { DisplayStatus }

export const displayStatus = (row: AttendanceDayRow): DisplayStatus => displayStatusOf(row)

/**
 * "20m late", or nothing at all.
 *
 * Only ever shown beside a late badge: a zero here means on time, and "0m
 * late" next to a Present badge reads like a fault rather than the absence of
 * one. Over an hour it switches to hours and minutes, because "95m late" is
 * arithmetic the reader should not have to do.
 */
export function lateBy(row: AttendanceDayRow): string {
  const m = row.late_minutes
  if (!m || m <= 0) return ''
  if (m < 60) return `${m}m late`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h late` : `${h}h ${rem}m late`
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  not_checked_out: 'Not checked out',
  on_leave: 'On leave',
  day_off: 'Day off',
}

export const STATUS_TONE: Record<DisplayStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  not_checked_out: 'info',
  on_leave: 'info',
  day_off: 'info',
}

export interface AttendanceSummary {
  total: number
  present: number
  absent: number
  notCheckedOut: number
  onLeave: number
  /** Whole percent of the team that turned up at all. */
  percent: number
}

/**
 * Anyone who came in counts as present for the percentage — late is still
 * turning up, and someone who has not checked out has certainly arrived.
 */
export const summarise = (rows: readonly AttendanceDayRow[]): AttendanceSummary =>
  summariseRoster(rows)

export interface AttendanceFilters {
  search: string
  status: DisplayStatus | 'all'
  /** Engagement: '', 'in_house' or 'freelancer'. */
  type: string
}

export const EMPTY_FILTERS: AttendanceFilters = { search: '', status: 'all', type: '' }

export const hasFilters = (f: AttendanceFilters): boolean =>
  f.search.trim() !== '' || f.status !== 'all' || f.type !== ''

function matchesSearch(row: AttendanceDayRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [row.name, row.email, row.phone]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle))
}

/**
 * Narrow a roster in the browser.
 *
 * The dashboard no longer calls this — status and engagement go to the API,
 * so the count under the list describes the list. It stays for the personal
 * view, which holds one member's whole history in memory and has no pager to
 * contradict, and it delegates the status and engagement rules to the same
 * `matchesRoster` the API uses.
 */
export function filterRows(
  rows: readonly AttendanceDayRow[],
  filters: AttendanceFilters,
): AttendanceDayRow[] {
  return rows.filter(
    (r) => matchesRoster(r, { status: filters.status, type: filters.type }) && matchesSearch(r, filters.search),
  )
}

const timeFormat = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' })

/** "9:04 am", or a dash — never an empty cell that reads as a rendering bug. */
export const formatTime = (iso: string | null): string =>
  iso ? timeFormat.format(new Date(iso)) : '—'

/** Hours between check-in and check-out, to one decimal. Null while still in. */
export function hoursWorked(row: AttendanceDayRow): number | null {
  if (!row.check_in_at || !row.check_out_at) return null
  const ms = new Date(row.check_out_at).getTime() - new Date(row.check_in_at).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  return Math.round((ms / 3_600_000) * 10) / 10
}

const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_HEADERS = [
  'Name',
  'Email',
  'Phone',
  'Engagement',
  'Status',
  'Late by (min)',
  'Checked in',
  'Checked out',
  'Hours',
] as const

/** CSV of the rows on screen — the filtered set, in the order shown. */
export function toCsv(rows: readonly AttendanceDayRow[]): string {
  const lines = rows.map((r) =>
    [
      r.name,
      r.email,
      r.phone,
      r.engagement_type,
      STATUS_LABEL[displayStatus(r)],
      r.late_minutes > 0 ? String(r.late_minutes) : '',
      r.check_in_at,
      r.check_out_at,
      hoursWorked(r),
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_HEADERS.join(','), ...lines].join('\n')
}

/** Today in the browser's timezone, as the date input wants it. */
export const todayISO = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
