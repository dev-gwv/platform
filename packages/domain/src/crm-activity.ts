/**
 * Activities: the words the timeline uses for what a person did.
 */
export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'task' | 'whatsapp' | 'sms'
export type ActivityDirection = 'in' | 'out' | 'none'

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  task: 'Task',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
}

/**
 * How a call went. The first four are the everyday ones (one tap each after a
 * call); 0201 decides what each does to the lead: an answer or a call-back
 * request resets the misses, three misses in a row or a wrong number marks
 * the lead unreachable.
 */
export const CALL_OUTCOMES: ReadonlyArray<{ key: string; label: string; missed?: boolean }> = [
  { key: 'answered', label: 'Answered' },
  { key: 'no_answer', label: 'No answer', missed: true },
  { key: 'busy', label: 'Busy', missed: true },
  { key: 'callback', label: 'Call back later' },
  { key: 'switched_off', label: 'Switched off', missed: true },
  { key: 'voicemail', label: 'Voicemail', missed: true },
  { key: 'wrong_number', label: 'Wrong number' },
]

export interface ActivityShape {
  type: ActivityType
  direction: ActivityDirection
  subject: string | null
  outcome: string | null
  duration_s: number | null
  due_at: string | null
  done_at: string | null
  actor_name?: string | null | undefined
}

/** "12m call · answered", "Inbound email: Re: quote", "Task · due 7 Sep". */
export function describeActivity(a: ActivityShape, now: Date = new Date()): string {
  const who = a.direction === 'in' ? 'inbound ' : a.direction === 'out' ? 'outbound ' : ''
  if (a.type === 'task') {
    if (a.done_at) return `Task done${a.subject ? `: ${a.subject}` : ''}`
    if (!a.due_at) return `Task${a.subject ? `: ${a.subject}` : ''}`
    const due = new Date(a.due_at)
    const late = due.getTime() < now.getTime()
    return `Task${a.subject ? `: ${a.subject}` : ''} · ${late ? 'overdue' : 'due'} ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
  }
  if (a.type === 'note') return a.subject ? `Note: ${a.subject}` : 'Note'
  const parts: string[] = []
  if (a.type === 'call' && a.duration_s) parts.push(`${Math.max(1, Math.round(a.duration_s / 60))}m`)
  parts.push(`${who}${ACTIVITY_LABEL[a.type].toLowerCase()}`.trim())
  let out = parts.join(' ')
  out = out.charAt(0).toUpperCase() + out.slice(1)
  if (a.subject) out += `: ${a.subject}`
  if (a.outcome) out += ` · ${CALL_OUTCOMES.find((o) => o.key === a.outcome)?.label ?? a.outcome}`
  return out
}

/** Whether a task is owed today or earlier. */
export function taskDueBy(a: Pick<ActivityShape, 'type' | 'due_at' | 'done_at'>, endOfDay: Date): boolean {
  return a.type === 'task' && !a.done_at && !!a.due_at && new Date(a.due_at).getTime() <= endOfDay.getTime()
}

export interface TimelineEntry {
  kind: 'event' | 'activity'
  at: string
}

/** Newest first; an event and an activity at the same instant keep the event first. */
export function sortTimeline<T extends TimelineEntry>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.at.localeCompare(a.at) || (a.kind === 'event' ? -1 : 1))
}
