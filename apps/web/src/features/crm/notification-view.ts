import type { Notification } from '@ipc/contracts'
import { dateLabel } from '@/features/reminders/remind-times'

/**
 * "just now", "5m ago", "2h ago", "3d ago" — and past a week, the date
 * ("12 Sep", with the year once it is not this one), because "41d ago" makes
 * people count. Dates are India dates, like every other date in the app.
 * A time a little in the future (a clock running fast) reads "just now".
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000)
  if (Number.isNaN(mins)) return ''
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d ago` : dateLabel(at, now)
}

/** A place in the app, split the way TanStack Router's `navigate` takes it. */
export interface LinkTarget {
  to: string
  search?: Record<string, string>
}

/**
 * A deep link as navigate() needs it.
 *
 * The link is a plain string written by whatever raised the alert — a SQL
 * job, usually — so it can carry a query string. TanStack matches `to`
 * against route paths, so `/follow-ups?lead=abc` would look for a route
 * literally named that and land on the not-found page: the query is split
 * off here. Anything that is not a path inside this app (a full URL, or a
 * `//host` one) gives null, and is not followed.
 */
export function splitDeepLink(link: string): LinkTarget | null {
  const s = link.trim()
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return null
  const noHash = s.split('#')[0] ?? s
  const q = noHash.indexOf('?')
  if (q === -1) return { to: noHash }
  const to = noHash.slice(0, q) || '/'
  const search = Object.fromEntries(new URLSearchParams(noHash.slice(q + 1)))
  return Object.keys(search).length > 0 ? { to, search } : { to }
}

/**
 * Where tapping an alert goes: its deep link when it has one. A reminder
 * raised before reminders carried links still has a home — the reminders
 * board; anything else without one opens the full Alerts page, where its
 * whole text is.
 */
export function notificationTarget(n: Pick<Notification, 'deep_link' | 'type'>): LinkTarget {
  const link = n.deep_link ? splitDeepLink(n.deep_link) : null
  if (link) return link
  if (n.type === 'reminder' || n.type.startsWith('reminder.')) return { to: '/reminders' }
  return { to: '/notifications' }
}

/** The bell's badge: the count, up to "9+". */
export const badgeText = (unread: number): string => (unread > 9 ? '9+' : String(unread))
