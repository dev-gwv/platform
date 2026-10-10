/**
 * How long is left before something is due, the way a person says it:
 * "Due today", "Due tomorrow", "4 days left", "2 days late". One wording for
 * every due date the team sees -- edits, tasks, the top bar -- with the tone
 * that goes with it: red once late, amber within two days, calm otherwise.
 */
type DueTone = 'late' | 'soon' | 'calm'

const dayMs = 86_400_000

/** Today's date (yyyy-mm-dd) in India, where the studios are. */
export function todayInIndia(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

export function daysUntil(due: string, today = todayInIndia()): number {
  return Math.round((Date.parse(due.slice(0, 10)) - Date.parse(today)) / dayMs)
}

export function daysLeftText(days: number): string {
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days < 0) return days === -1 ? '1 day late' : `${-days} days late`
  return `${days} days left`
}

export function dueTone(days: number): DueTone {
  if (days < 0) return 'late'
  if (days <= 2) return 'soon'
  return 'calm'
}

/** "4 days left" and its tone for a date, or null when there is none. */
export function daysLeft(due: string | null | undefined, today = todayInIndia()): { days: number; text: string; tone: DueTone } | null {
  if (!due) return null
  const days = daysUntil(due, today)
  return { days, text: daysLeftText(days), tone: dueTone(days) }
}

/** Chip classes for a tone: red when late, amber when close, quiet otherwise. */
export const DUE_TONE_CLASS: Record<DueTone, string> = {
  late: 'bg-destructive/10 text-destructive border-destructive/30',
  soon: 'bg-warning/15 text-warning border-warning/40',
  calm: 'bg-muted text-foreground/80 border-border',
}
