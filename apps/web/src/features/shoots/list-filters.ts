/**
 * The Shoots list's date choices, worked out from the shoot's day alone so the
 * list, its count and the test agree. "This week" is Monday to Sunday;
 * a month is written "2026-10".
 */
export type DateChoice = 'all' | 'upcoming' | 'past' | 'today' | 'this_week' | 'unscheduled' | `month:${string}`

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function weekOf(today: string): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00`)
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { from: iso(monday), to: iso(sunday) }
}

export function matchesDate(day: string | null, choice: DateChoice, today: string): boolean {
  if (choice === 'all') return true
  if (choice === 'unscheduled') return !day
  if (!day) return false
  if (choice === 'upcoming') return day >= today
  if (choice === 'past') return day < today
  if (choice === 'today') return day === today
  if (choice === 'this_week') {
    const w = weekOf(today)
    return day >= w.from && day <= w.to
  }
  return day.startsWith(choice.slice('month:'.length))
}

/** The months that have shoots, newest first, labelled "Oct 2026". */
export function monthsOf(days: ReadonlyArray<string | null>): Array<{ value: `month:${string}`; label: string }> {
  const keys = [...new Set(days.filter((d): d is string => !!d).map((d) => d.slice(0, 7)))].sort().reverse()
  return keys.map((k) => ({
    value: `month:${k}` as const,
    label: new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
  }))
}
