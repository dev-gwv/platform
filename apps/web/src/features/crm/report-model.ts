import type { CrmStats } from '@ipc/contracts'

/**
 * The plain-words half of the lead reports: what the follow-up numbers mean,
 * and the daily series laid out on a calendar the eye can read. Pure, so the
 * sentences and the bucketing are tested rather than eyeballed.
 */

type Health = CrmStats['follow_up_health']

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "2 follow-ups overdue and 3 due today. 4 open leads have no follow-up set." */
export function followUpSentence(h: Health): string {
  const now = [
    h.overdue ? `${plural(h.overdue, 'follow-up')} overdue` : null,
    h.due_today ? `${h.due_today} due today` : null,
  ].filter(Boolean)
  const parts: string[] = []
  if (now.length) parts.push(`${now.join(' and ')}.`)
  else parts.push('Nothing overdue or due today.')
  const ahead = h.due_tomorrow + h.upcoming_7d
  if (ahead) parts.push(`${ahead} more in the next week.`)
  if (h.no_follow_up)
    parts.push(`${plural(h.no_follow_up, 'open lead has', 'open leads have')} no follow-up set.`)
  return parts.join(' ')
}

/** Hot, warm, cold first, then the studio's own words, then "not set". */
export function qualityRows(breakdown: Record<string, number>): Array<{ key: string; count: number }> {
  const order = ['hot', 'warm', 'cold']
  const rank = (k: string) => (k === 'unset' ? 99 : order.includes(k) ? order.indexOf(k) : 50)
  return Object.entries(breakdown)
    .filter(([, n]) => n > 0)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => rank(a.key) - rank(b.key) || b.count - a.count || a.key.localeCompare(b.key))
}

export type Bucket<K extends string> = { key: string; label: string } & Record<K, number>

const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`)

/**
 * Every day from `from` to `to`, gaps filled with 0, so a quiet week shows as
 * quiet rather than vanishing. Past ~6 weeks a column a day is too thin to
 * read, so days fold into weeks (Monday-start); past ~6 months, into months.
 */
export function bucketSeries<K extends string>(
  rows: ReadonlyArray<{ day: string } & Partial<Record<K, number>>>,
  keys: readonly K[],
  from: string,
  to: string,
): Array<Bucket<K>> {
  const start = day(from)
  const end = day(to)
  if (!(end >= start)) return []
  const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  const grain: 'day' | 'week' | 'month' = span > 186 ? 'month' : span > 45 ? 'week' : 'day'

  const keyOf = (d: Date): string => {
    if (grain === 'day') return iso(d)
    if (grain === 'month') return iso(d).slice(0, 7)
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return iso(monday)
  }
  const labelOf = (k: string): string => {
    if (grain === 'month') return day(`${k}-01`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    const d = day(k)
    const text = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    return grain === 'week' ? `Week of ${text}` : text
  }

  const out = new Map<string, Bucket<K>>()
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = keyOf(d)
    if (!out.has(k)) {
      const b = { key: k, label: labelOf(k) } as Bucket<K>
      for (const key of keys) (b as Record<string, number | string>)[key] = 0
      out.set(k, b)
    }
  }
  for (const r of rows) {
    const b = out.get(keyOf(day(r.day)))
    if (!b) continue
    for (const key of keys) (b as Record<string, number | string>)[key] = (b[key] as number) + (r[key] ?? 0)
  }
  return [...out.values()]
}
