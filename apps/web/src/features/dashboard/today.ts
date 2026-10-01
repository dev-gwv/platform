import type { MyDeliverable, MyFollowUp, TaskListItem, TeamSlot } from '@ipc/contracts'
import { clockRange, localDate, localDay, slotWhat, timeLabel } from '@/features/shoots/assign'

/**
 * A team member's day, as one list in time order, and the week after it.
 *
 * Everything given to them -- shoots, tasks, edits, cards to hand over, calls
 * from the CRM -- turned into one line each with its one action. Pure, so the
 * rules can be read and tested without a screen: what is late comes first,
 * then the day by the clock, then what is due "today" with no hour.
 */

export type TodayKind = 'shoot' | 'task' | 'edit' | 'handover' | 'call'

export interface TodayItem {
  kind: TodayKind
  id: string
  /** The line itself: "3–6 PM · Engagement (Sharma Wedding)". */
  title: string
  /** Where it stands, in a few words: "Due today", "2 days late", "Start today". */
  note: string
  late: boolean
  /** For ordering: late first, then the clock, then the rest of today. */
  sort: string
  slot?: TeamSlot
  task?: TaskListItem
  edit?: MyDeliverable
  call?: MyFollowUp
}

export interface DayInput {
  me: string | null | undefined
  slots: readonly TeamSlot[]
  tasks: readonly TaskListItem[]
  edits: readonly MyDeliverable[]
  calls: readonly MyFollowUp[]
  /** Booking ids whose cards are still with the person. */
  owedCards: ReadonlySet<string>
  now: Date
  /** Days ahead "Coming up" looks. */
  ahead?: number
}

const DAY_MS = 86_400_000

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return localDate(d)
}

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / DAY_MS)

export function lateText(days: number): string {
  return days === 1 ? '1 day late' : `${days} days late`
}

/** "Fri, 23 Oct" for anything after today. */
export function dayText(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

const isOpenTask = (t: TaskListItem) => t.status !== 'completed' && t.status !== 'cancelled'

export function myDay(input: DayInput): { today: TodayItem[]; next: TodayItem[] } {
  const { me, now } = input
  const today = localDate(now)
  const until = addDays(today, input.ahead ?? 7)
  const nowIso = now.toISOString()
  const todayList: TodayItem[] = []
  const nextList: TodayItem[] = []

  // Shoots: today's by the clock (until they end), the week's after.
  for (const s of input.slots) {
    if (s.status !== 'booked' || (me && s.user_id !== me)) continue
    if (s.end_at < nowIso) continue
    const day = localDay(s.start_at)
    const item: TodayItem = {
      kind: 'shoot',
      id: s.id,
      title: `${clockRange(s.start_at, s.end_at)} · ${slotWhat(s)}`,
      note: s.service_name ?? 'Shoot',
      late: false,
      sort: `1${s.start_at}`,
      slot: s,
    }
    if (day <= today) todayList.push(item)
    else if (day <= until) nextList.push({ ...item, title: `${dayText(day)} · ${item.title}`, sort: s.start_at })
  }

  // Cards to hand over: today, until they are in.
  for (const s of input.slots) {
    if (!input.owedCards.has(s.id)) continue
    todayList.push({
      kind: 'handover',
      id: `handover:${s.id}`,
      title: `Hand over your cards · ${slotWhat(s)}`,
      note: `Shot ${dayText(localDay(s.start_at))}`,
      late: false,
      sort: '2',
      slot: s,
    })
  }

  // Tasks: late and due today now, the week's after.
  for (const t of input.tasks) {
    if (!isOpenTask(t) || !t.due_date) continue
    const title = t.project_name ? `${t.title} · ${t.project_name}` : t.title
    if (t.due_date < today) {
      const n = daysBetween(t.due_date, today)
      todayList.push({ kind: 'task', id: t.id, title, note: lateText(n), late: true, sort: `0${t.due_date}`, task: t })
    } else if (t.due_date === today) {
      todayList.push({ kind: 'task', id: t.id, title, note: 'Due today', late: false, sort: '2', task: t })
    } else if (t.due_date <= until) {
      nextList.push({ kind: 'task', id: t.id, title, note: `Due ${dayText(t.due_date)}`, late: false, sort: `${t.due_date}T23`, task: t })
    }
  }

  // Edits: sent back, late to start, or due; the week's after.
  for (const d of input.edits) {
    const title = `${d.title} · ${d.project_name}`
    const base = { kind: 'edit' as const, id: d.id, title, edit: d }
    if (d.changes_requested) {
      todayList.push({ ...base, note: 'Sent back for changes', late: false, sort: '05' })
    } else if (!d.started_at && d.start_by && d.start_by <= today) {
      const n = daysBetween(d.start_by, today)
      todayList.push({ ...base, note: n > 0 ? `Start · ${lateText(n)}` : 'Start today', late: n > 0, sort: n > 0 ? `0${d.start_by}` : '2' })
    } else if (d.estimated_date && d.estimated_date < today) {
      todayList.push({ ...base, note: lateText(daysBetween(d.estimated_date, today)), late: true, sort: `0${d.estimated_date}` })
    } else if (d.estimated_date === today) {
      todayList.push({ ...base, note: 'Due today', late: false, sort: '2' })
    } else if (!d.started_at && d.start_by && d.start_by <= until) {
      nextList.push({ ...base, note: `Start ${dayText(d.start_by)}`, late: false, sort: `${d.start_by}T22` })
    } else if (d.estimated_date && d.estimated_date <= until) {
      nextList.push({ ...base, note: `Due ${dayText(d.estimated_date)}`, late: false, sort: `${d.estimated_date}T23` })
    }
  }

  // Calls from the CRM: by the clock today (late if the hour has gone).
  for (const c of input.calls) {
    const day = localDay(c.due_at)
    const who = c.lead_name ?? 'a lead'
    const title = c.subject ? `${c.subject} · ${who}` : `Call ${who}`
    const base = { kind: 'call' as const, id: c.id, title, call: c }
    if (day < today) {
      todayList.push({ ...base, note: lateText(daysBetween(day, today)), late: true, sort: `0${day}` })
    } else if (day === today) {
      const gone = c.due_at < nowIso
      todayList.push({ ...base, note: gone ? `Was due ${timeLabel(c.due_at)}` : `At ${timeLabel(c.due_at)}`, late: gone, sort: gone ? `0${c.due_at}` : `1${c.due_at}` })
    } else if (day <= until) {
      nextList.push({ ...base, note: `${dayText(day)} · ${timeLabel(c.due_at)}`, late: false, sort: c.due_at })
    }
  }

  const bySort = (a: TodayItem, b: TodayItem) => a.sort.localeCompare(b.sort) || a.title.localeCompare(b.title)
  return { today: todayList.sort(bySort), next: nextList.sort(bySort) }
}

/** "3 tasks · 2 edits · 1 hand-over" -- what else is open, in one line. */
export function openWorkLine(counts: { tasks: number; edits: number; handovers: number }): string | null {
  const bits = [
    counts.tasks ? `${counts.tasks} task${counts.tasks === 1 ? '' : 's'}` : null,
    counts.edits ? `${counts.edits} edit${counts.edits === 1 ? '' : 's'}` : null,
    counts.handovers ? `${counts.handovers} hand-over${counts.handovers === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return bits.length ? bits.join(' · ') : null
}
