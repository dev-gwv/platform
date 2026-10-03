import type { GettingStarted } from '@ipc/contracts'

/**
 * Getting started on the dashboard: the five things a new studio does after
 * setup, each ticked by the data itself (never by a flag someone must set).
 * Setup's own three steps (team, client, first project) are never repeated
 * here.
 */
export interface StartStep {
  key: 'logo' | 'package' | 'enquiry' | 'booking' | 'quotation'
  title: string
  done: boolean
  to: string
  search?: Record<string, string>
  action: string
}

export const START_DAYS = 60

export function startSteps(g: GettingStarted): StartStep[] {
  return [
    { key: 'logo', title: 'Put your logo and name on everything', done: g.logo, to: '/settings/company', action: 'Add logo' },
    { key: 'package', title: 'Save your usual package', done: g.package, to: '/settings/project-templates', action: 'Save package' },
    { key: 'enquiry', title: 'Add your first enquiry', done: g.enquiry, to: '/follow-ups', action: 'Add enquiry' },
    { key: 'booking', title: 'Book a client with their shoot days', done: g.booking, to: '/projects/new', action: 'New booking' },
    { key: 'quotation', title: 'Send a quotation', done: g.quotation, to: '/projects', action: 'Open a project' },
  ]
}

/** Days since the studio started, in whole days. */
export function daysSince(iso: string, now = new Date()): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.floor((now.getTime() - t) / 86_400_000)
}

/**
 * Whether the card shows: once setup is closed, for the first 60 days, until
 * all five are done or the person closes it.
 */
export function showGettingStarted(g: GettingStarted | undefined, closed: boolean, now = new Date()): boolean {
  if (!g || closed || !g.setup_closed) return false
  if (daysSince(g.started_at, now) > START_DAYS) return false
  return startSteps(g).some((s) => !s.done)
}

/** "2 of 5 done" -- the count moves with every tick. */
export function startCountLine(steps: readonly StartStep[]): string {
  return `${steps.filter((s) => s.done).length} of ${steps.length} done`
}
