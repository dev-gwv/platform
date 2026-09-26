import type { ClientPortalDeliverableStatus } from '@ipc/contracts'

/** "just now", "5 minutes ago", "yesterday", "2 days ago", "3 weeks ago"... in plain words. */
export function openedAgo(iso: string, now: Date = new Date()): string {
  const secs = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return plural(mins, 'minute')
  const hours = Math.floor(mins / 60)
  if (hours < 24) return plural(hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 14) return plural(days, 'day')
  if (days < 60) return plural(Math.floor(days / 7), 'week')
  return plural(Math.floor(days / 30), 'month')
}

/** What a client reads for a deliverable's progress. */
export const DELIVERABLE_STATUS_LABEL: Record<ClientPortalDeliverableStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready: 'Ready',
}

/** A full link from what the API returned (it may be a bare `/p/<token>` path). */
export function absolutePortalUrl(url: string, origin: string): string {
  return url.startsWith('/') ? `${origin.replace(/\/+$/, '')}${url}` : url
}
