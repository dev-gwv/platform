import type { PlatformOffer, StudioActivity } from '@ipc/contracts'
import type { ToneName } from '@/shared/ui/tones'

/**
 * How busy a studio is, in one word the platform owner can sort a call list
 * by (0268): Busy (in on 3+ days this week and has made work), Trying it (in
 * this week), Gone quiet (made things or was in, but not this week), Never
 * started (nothing made, not in for 30 days).
 */
export type ActivityLevel = 'busy' | 'trying' | 'quiet' | 'never'

export const ACTIVITY: Record<ActivityLevel, { label: string; tone: ToneName; rank: number }> = {
  busy: { label: 'Busy', tone: 'green', rank: 3 },
  trying: { label: 'Trying it', tone: 'blue', rank: 2 },
  quiet: { label: 'Gone quiet', tone: 'amber', rank: 1 },
  never: { label: 'Never started', tone: 'slate', rank: 0 },
}

export function activityLevel(a: StudioActivity | undefined): ActivityLevel {
  if (!a) return 'never'
  const made = a.projects + a.invoices
  if (a.active_days_7 >= 3 && made > 0) return 'busy'
  if (a.active_days_7 >= 1) return 'trying'
  if (made + a.leads === 0 && a.active_days_30 === 0) return 'never'
  return 'quiet'
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "12 projects · 4 invoices · 30 leads · 5 team", leaving out what is nothing. */
export function madeLine(a: StudioActivity | undefined): string {
  if (!a) return 'Nothing made yet'
  const parts = [
    a.projects && plural(a.projects, 'project'),
    a.invoices && plural(a.invoices, 'invoice'),
    a.leads && plural(a.leads, 'lead'),
    a.shoots && plural(a.shoots, 'shoot'),
    a.team && `${a.team} team`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing made yet'
}

/** "Today", "Yesterday", "3 days ago", or "Not in 30 days" -- by India dates. */
export function lastActiveWords(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Not in 30 days'
  const day = (t: number) => Math.floor((t + 5.5 * 3_600_000) / 86_400_000)
  const d = day(now) - day(new Date(iso).getTime())
  if (d <= 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}

/** Where an offer stands, for the Offers list: Paid, Ended, Ran out, Asked, Seen, Sent. */
export function offerState(o: PlatformOffer, now = Date.now()): { label: string; tone: ToneName } {
  if (o.used_at) return { label: `Paid${o.used_plan ? ` · ${o.used_plan.replace(/_regular$/, '').replace(/_/g, ' ')}` : ''}`, tone: 'green' }
  if (o.cancelled_at) return { label: 'Ended', tone: 'slate' }
  if (new Date(o.ends_at).getTime() <= now) return { label: o.asked_at ? 'Asked, ran out' : 'Ran out', tone: 'slate' }
  if (o.asked_at) return { label: 'Asked on WhatsApp', tone: 'violet' }
  if (o.seen_at) return { label: 'Seen', tone: 'blue' }
  return { label: 'Sent', tone: 'amber' }
}
