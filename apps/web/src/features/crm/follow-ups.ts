/**
 * Follow-ups as a list of promises (0209): when each one is owed, how the
 * drawer and the Today page group them, and the preset times people pick.
 * Pure, so the edges (midnight, "next week" on a Sunday) are tested.
 */

export type FollowUpBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'

export const BUCKET_LABEL: Record<FollowUpBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  later: 'Later',
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Where a follow-up due at `due` falls, seen from `now` (the viewer's day). */
export function followUpBucket(due: string | Date, now: Date = new Date()): FollowUpBucket {
  const at = typeof due === 'string' ? new Date(due) : due
  if (at.getTime() < now.getTime()) return 'overdue'
  const today = startOfDay(now)
  if (at < addDays(today, 1)) return 'today'
  if (at < addDays(today, 2)) return 'tomorrow'
  if (at < addDays(today, 7)) return 'week'
  return 'later'
}

export type FollowUpPreset = 'today' | 'tomorrow' | 'three_days' | 'next_week'

export const FOLLOW_UP_PRESETS: ReadonlyArray<{ key: FollowUpPreset; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'three_days', label: 'In 3 days' },
  { key: 'next_week', label: 'Next week' },
]

/**
 * The time a preset means. Morning follow-ups are at 11, when people pick up;
 * "today" is two hours from now, or 6 pm if that is later, and never past 9 pm.
 */
export function presetAt(key: FollowUpPreset, now: Date = new Date()): Date {
  if (key === 'today') {
    const inTwo = new Date(now.getTime() + 2 * 3600_000)
    const six = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0)
    const at = inTwo > six ? inTwo : six
    const nine = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0)
    return at > nine ? nine : at
  }
  const days = key === 'tomorrow' ? 1 : key === 'three_days' ? 3 : 7
  const d = addDays(now, days)
  d.setHours(11, 0, 0, 0)
  return d
}

/** A datetime-local value in the viewer's timezone. */
export function toLocalInput(d: Date | string | null): string {
  if (!d) return ''
  const at = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' })

/** "Today 4:30 pm", "Tomorrow 11:00 am", "Fri 3 Oct 11:00 am", "2 days late". */
export function dueWords(due: string | Date, now: Date = new Date()): string {
  const at = typeof due === 'string' ? new Date(due) : due
  const b = followUpBucket(at, now)
  if (b === 'overdue') {
    const days = Math.floor((startOfDay(now).getTime() - startOfDay(at).getTime()) / 86_400_000)
    return days <= 0 ? `Overdue since ${timeFmt.format(at)}` : `${days} day${days === 1 ? '' : 's'} late`
  }
  if (b === 'today') return `Today ${timeFmt.format(at)}`
  if (b === 'tomorrow') return `Tomorrow ${timeFmt.format(at)}`
  return `${dayFmt.format(at)} ${timeFmt.format(at)}`
}

/** Should the reminder toast fire for a follow-up due at `due`? The ten minutes before, and the first minute late. */
export function shouldRemind(due: string | Date, now: Date = new Date()): boolean {
  const ms = (typeof due === 'string' ? new Date(due) : due).getTime() - now.getTime()
  return ms <= 10 * 60_000 && ms > -60_000
}

type FollowUpTask = { id: string; lead_id: string | null; due_at: string | null }

/**
 * Today's calls is one list (owner's audit: the follow-up board above the
 * queue showed the same people twice). A promised follow-up rides on its
 * lead's call row -- the earliest open one -- and only the follow-ups whose
 * lead is not in the queue (tomorrow, later this week, or someone else's
 * lead) are listed after it, soonest first. Anything past the week is left
 * to the Leads page.
 */
export function mergeFollowUps<T extends FollowUpTask>(
  queueLeadIds: Iterable<string>,
  tasks: readonly T[],
  now: Date = new Date(),
): { onRow: Map<string, T>; after: T[] } {
  const inQueue = new Set(queueLeadIds)
  const onRow = new Map<string, T>()
  const after = new Map<string, T>()
  const soonest = [...tasks]
    .filter((t) => t.due_at && t.lead_id && followUpBucket(t.due_at, now) !== 'later')
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))
  for (const t of soonest) {
    const lead = t.lead_id!
    const into = inQueue.has(lead) ? onRow : after
    if (!into.has(lead)) into.set(lead, t)
  }
  return { onRow, after: [...after.values()] }
}
