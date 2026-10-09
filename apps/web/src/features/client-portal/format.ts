import type { ClientPortalDeliverableStatus, PublicClientPortal } from '@ipc/contracts'

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

/** What a client reads for a deliverable's progress (0252). */
export const DELIVERABLE_STATUS_LABEL: Record<ClientPortalDeliverableStatus, string> = {
  not_started: 'Not started',
  in_progress: 'Being edited',
  final_checks: 'Final checks',
  ready: 'Ready to view',
  delivered: 'Delivered',
}

export type StepState = 'done' | 'now' | 'todo'
export interface TrackerStep {
  key: 'booked' | 'shoots' | 'footage' | 'editing' | 'ready' | 'delivered'
  label: string
  state: StepState
  /** One plain line under the step: "2 of 4 done · next: Sangeet, Fri 23 Oct". */
  line: string | null
}

const dayLabel = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${d}T12:00:00+05:30`))

/**
 * The couple's tracker, Amazon-style: Booked → Shoot days → Footage safe →
 * Editing → Ready to view → Delivered. Every step before the first unfinished
 * one is done, that one is "now", the rest are still to come. Footage safe is
 * left out for a studio that keeps no data records.
 */
export function trackerSteps(data: Pick<PublicClientPortal, 'booked' | 'footage' | 'shoots' | 'deliverables'>, today: string): TrackerStep[] {
  const shoots = data.shoots.filter((s) => s.status !== 'cancelled')
  const dated = shoots.filter((s) => s.shoot_date)
  const shot = dated.filter((s) => s.shoot_date! <= today).length
  const next = dated
    .filter((s) => s.shoot_date! > today)
    .sort((a, b) => a.shoot_date!.localeCompare(b.shoot_date!))[0]
  const work = data.deliverables
  const count = (...st: ClientPortalDeliverableStatus[]) => work.filter((d) => st.includes(d.status)).length
  const delivered = count('delivered')
  const editing = work.find((d) => d.status === 'in_progress' || d.status === 'final_checks')
  const toView = count('ready')

  const booked = !!(data.booked.quotation_accepted_at || data.booked.terms_agreed_at) || shoots.length > 0
  const shootsDone = shoots.length > 0 && shot === shoots.length
  const footageDone = data.footage.shot > 0 && data.footage.safe >= data.footage.shot && shootsDone
  const editingDone = work.length > 0 && count('ready', 'delivered') === work.length
  const readyDone = work.length > 0 && delivered === work.length

  const raw: { key: TrackerStep['key']; label: string; done: boolean; line: string | null; show: boolean }[] = [
    {
      key: 'booked', label: 'Booked', done: booked, show: true,
      line: data.booked.terms_agreed_at ? 'Terms signed' : data.booked.quotation_accepted_at ? 'Quotation accepted' : null,
    },
    {
      key: 'shoots', label: 'Shoot days', done: shootsDone, show: true,
      line: shoots.length === 0
        ? 'Dates to be fixed'
        : `${shot} of ${shoots.length} done${next ? ` · next: ${next.name}, ${dayLabel(next.shoot_date!)}` : ''}`,
    },
    {
      key: 'footage', label: 'Footage safe', done: footageDone, show: data.footage.tracks,
      line: data.footage.shot > 0 ? `${data.footage.safe} of ${data.footage.shot} days backed up` : null,
    },
    {
      key: 'editing', label: 'Editing', done: editingDone, show: true,
      line: editing ? `${editing.title} being edited` : null,
    },
    {
      key: 'ready', label: 'Ready to view', done: readyDone, show: true,
      line: toView > 0 ? `${toView} waiting for your look` : null,
    },
    {
      key: 'delivered', label: 'Delivered', done: readyDone, show: true,
      line: work.length > 0 ? `${delivered} of ${work.length} delivered` : null,
    },
  ]
  const steps = raw.filter((r) => r.show)
  const firstOpen = steps.findIndex((s) => !s.done)
  return steps.map((s, i) => ({
    key: s.key,
    label: s.label,
    line: s.line,
    state: firstOpen === -1 || i < firstOpen ? 'done' : i === firstOpen ? 'now' : 'todo',
  }))
}

/** "Expected by 5 Nov" only while the date is ahead; after it, "Coming soon" -- never "late". */
export function expectedLine(expected: string | null, today: string, fmt: (d: string) => string): string {
  if (!expected) return 'We will share a date soon'
  return expected >= today ? `Expected by ${fmt(expected)}` : 'Coming soon'
}

/** A full link from what the API returned (it may be a bare `/p/<token>` path). */
export function absolutePortalUrl(url: string, origin: string): string {
  return url.startsWith('/') ? `${origin.replace(/\/+$/, '')}${url}` : url
}
