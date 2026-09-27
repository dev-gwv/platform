/** The next-call shortcuts after a call, as ISO instants. */
export type NextCall = 'none' | 'hour' | 'evening' | 'tomorrow' | 'three_days'

export const NEXT_CALLS: { key: NextCall; label: string }[] = [
  { key: 'hour', label: 'In 1 hour' },
  { key: 'evening', label: 'This evening' },
  { key: 'tomorrow', label: 'Tomorrow 11 am' },
  { key: 'three_days', label: 'In 3 days' },
  { key: 'none', label: 'No follow-up' },
]

export function nextCallAt(key: NextCall, now: Date = new Date()): string | null {
  const d = new Date(now)
  switch (key) {
    case 'none':
      return null
    case 'hour':
      return new Date(now.getTime() + 3_600_000).toISOString()
    case 'evening':
      d.setHours(18, 0, 0, 0)
      // Already past six: the same time tomorrow evening.
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
      return d.toISOString()
    case 'tomorrow':
      d.setDate(d.getDate() + 1)
      d.setHours(11, 0, 0, 0)
      return d.toISOString()
    case 'three_days':
      d.setDate(d.getDate() + 3)
      d.setHours(11, 0, 0, 0)
      return d.toISOString()
  }
}

/** What to suggest after each outcome, so most calls log in two taps. */
export function suggestedNext(outcome: string): NextCall {
  if (outcome === 'callback') return 'evening'
  if (outcome === 'no_answer' || outcome === 'busy' || outcome === 'switched_off' || outcome === 'voicemail') return 'hour'
  if (outcome === 'wrong_number') return 'none'
  return 'three_days'
}
