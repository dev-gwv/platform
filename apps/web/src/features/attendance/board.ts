import type { TodayBoardRow } from '@ipc/contracts'

/**
 * The owner's Today board: everyone the studio tracks, in the group that
 * answers "where are they?" -- not in yet, late, in, on a shoot, on leave.
 * Pure, so the rules read (and test) without a screen.
 */
export type BoardGroup = 'not_in' | 'late' | 'in' | 'shoot' | 'leave'

export const GROUP_LABEL: Record<BoardGroup, string> = {
  not_in: 'Not in yet',
  late: 'Late',
  in: 'In',
  shoot: 'On a shoot',
  leave: 'On leave',
}

export const GROUP_ORDER: readonly BoardGroup[] = ['not_in', 'late', 'in', 'shoot', 'leave']

export function groupOf(r: TodayBoardRow): BoardGroup {
  if (r.leave === 'full' && !r.check_in_at) return 'leave'
  if (r.source === 'shoot' || (r.shoot && !r.check_in_at)) return 'shoot'
  if (r.check_in_at && r.status === 'late') return 'late'
  if (r.check_in_at) return 'in'
  return 'not_in'
}

/** Past their start plus grace, on the studio's clock ("HH:MM" now). */
export function overdue(r: TodayBoardRow, nowClock: string): boolean {
  if (!r.expected) return false
  const [h, m] = r.expected.split(':').map(Number) as [number, number]
  const due = h * 60 + m + (r.grace ?? 0)
  const [nh, nm] = nowClock.split(':').map(Number) as [number, number]
  return nh * 60 + nm > due
}

export function groupRows(rows: readonly TodayBoardRow[]): Record<BoardGroup, TodayBoardRow[]> {
  const out: Record<BoardGroup, TodayBoardRow[]> = { not_in: [], late: [], in: [], shoot: [], leave: [] }
  for (const r of rows) out[groupOf(r)].push(r)
  return out
}

/** "7 of 9 in · 1 late · 2 not in yet · 1 on a shoot · 1 on leave". */
export function boardSentence(rows: readonly TodayBoardRow[]): string {
  const g = groupRows(rows)
  const due = rows.length - g.leave.length
  const inNow = g.in.length + g.late.length
  const bits = [
    `${inNow} of ${due - g.shoot.length} in`,
    g.late.length ? `${g.late.length} late` : null,
    g.not_in.length ? `${g.not_in.length} not in yet` : null,
    g.shoot.length ? `${g.shoot.length} on a shoot` : null,
    g.leave.length ? `${g.leave.length} on leave` : null,
  ].filter(Boolean)
  return bits.join(' · ')
}

/** "10:22 AM" on the viewer's clock. */
export const clockText = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** "1h 5m late" / "22 min late". */
export function lateText(minutes: number): string {
  if (minutes < 60) return `${minutes} min late`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m late` : `${h}h late`
}

/** "In 10:22 AM · 22 min late · Studio · 40 m · ±12 m" -- where and when, in one line. */
export function inLine(r: TodayBoardRow): string {
  if (!r.check_in_at) return ''
  const bits = [
    `In ${clockText(r.check_in_at)}`,
    r.status === 'late' && r.late_minutes > 0 ? lateText(r.late_minutes) : null,
    r.status === 'half_day' ? 'Half day' : null,
    r.place_name ? `${r.place_name}${r.distance_m != null ? ` · ${r.distance_m} m` : ''}` : null,
    r.accuracy_m != null ? `±${r.accuracy_m} m` : null,
    r.check_out_at ? `Out ${clockText(r.check_out_at)}${r.closed_by_system ? ' (closed for them)' : ''}` : null,
  ].filter(Boolean)
  return bits.join(' · ')
}

/** "10:00" (24 h, the studio's) as "10:00 am". */
export const dayClock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

/**
 * "3 Oct 2026" for the moment attendance went on, as India's date. The stamp
 * is a UTC instant; read in the browser's own zone, a switch made before
 * 5:30 am IST showed as the day before.
 */
export function enabledSinceText(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}
