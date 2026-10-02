import { formatINR } from '@/shared/ui/format'

const dateWords = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * The line under a part payment: what is still owed after this one, and when
 * it is due. Nothing for a promise (no money moves), while changing an old
 * payment, or when this payment clears what was due.
 */
export function leftToPayLine({
  due,
  amount,
  received,
  editing,
  dueOn,
  today,
}: {
  due: number
  amount: number
  received: boolean
  editing: boolean
  dueOn?: string | null | undefined
  today: string
}): string | null {
  if (editing || !received || !(due > 0) || !(amount > 0) || amount >= due) return null
  const left = formatINR(Math.round((due - amount) * 100) / 100)
  if (!dueOn) return `${left} is left to collect.`
  const day = dueOn.slice(0, 10)
  return day < today ? `${left} is left. It was due on ${dateWords(day)}.` : `${left} is left. It stays due on ${dateWords(day)}.`
}
