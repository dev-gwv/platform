import type { ModuleKey } from '@ipc/permissions'

export interface HubTab {
  to: string
  label: string
  module: ModuleKey
}

/**
 * Pages that belong together, reached from one sidebar entry and switched
 * between by a row of tabs at the top.
 *
 * The owner, on the Team menu: "there are a lot of options that give brain
 * fog... see how you can segregate it under one roof." Nine links became
 * four. Every page keeps its own address, so a bookmark, an email or a
 * notification still lands where it did; the sidebar only lights the hub.
 */
export const TEAM_PEOPLE: readonly HubTab[] = [
  { to: '/employees', label: 'Directory', module: 'team_directory' },
  { to: '/team/performance', label: 'Performance', module: 'team_directory' },
  { to: '/team/work-preview', label: 'Work preview', module: 'team_work_preview' },
]

export const TEAM_TIME: readonly HubTab[] = [
  { to: '/attendance', label: 'Attendance', module: 'attendance' },
  { to: '/leave', label: 'Leave & holidays', module: 'attendance' },
]

export const TEAM_PAY: readonly HubTab[] = [
  { to: '/payroll', label: 'Payroll', module: 'team_salaries' },
  { to: '/team/salaries', label: 'Monthly salaries', module: 'team_salaries' },
  { to: '/team-payouts', label: 'Team payouts', module: 'team_payouts' },
]

/** A team member's own time: their attendance and their leave. */
export const MY_TIME: readonly HubTab[] = [
  { to: '/attendance/my', label: 'Attendance', module: 'dashboard' },
  { to: '/leave', label: 'Leave', module: 'dashboard' },
]

/** Roles and terms are settings pages: the settings rail is their tab row. */
export const TEAM_SETUP: readonly HubTab[] = [
  { to: '/settings/roles', label: 'Roles & access', module: 'team_roles' },
  { to: '/settings/team-terms', label: 'Team terms', module: 'team_terms' },
]

/** The hubs that draw their own tab row (not the settings ones). */
export const TAB_HUBS: readonly (readonly HubTab[])[] = [TEAM_PEOPLE, TEAM_TIME, TEAM_PAY, MY_TIME]

/**
 * The hub whose tab row belongs on this exact page, if any. A page in two
 * hubs (/leave: the studio's leave and holidays, or a person's own) takes the
 * first one this person can switch around in.
 */
export function hubFor(pathname: string, can: (m: ModuleKey) => boolean = () => true): readonly HubTab[] | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  const found = TAB_HUBS.filter((h) => h.some((t) => t.to === p))
  return found.find((h) => h.filter((t) => can(t.module)).length >= 2) ?? found[0] ?? null
}
