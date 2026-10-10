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

// Team payouts first: most crews are freelancers paid per shoot, so Pay opens
// there. Monthly salaries is Payroll's history now (its older records).
export const TEAM_PAY: readonly HubTab[] = [
  { to: '/team-payouts', label: 'Team payouts', module: 'team_payouts' },
  { to: '/payroll', label: 'Payroll', module: 'team_salaries' },
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

/**
 * Every project, and the ones that need you today (Project Tracking was a
 * menu line of its own and a top-bar pill; it is a tab of Projects now).
 */
export const PROJECTS_HUB: readonly HubTab[] = [
  { to: '/projects', label: 'All projects', module: 'projects' },
  { to: '/project-tracking', label: 'Needs attention', module: 'projects' },
]

/**
 * The studio's money under one menu line. Payments comes first: it is the one
 * "what is due" page; Invoices is the list of documents.
 */
export const MONEY: readonly HubTab[] = [
  { to: '/billing/payments', label: 'Payments', module: 'billing' },
  { to: '/billing/invoices', label: 'Invoices', module: 'billing' },
  { to: '/company-expenses', label: 'Expenses', module: 'company_expenses' },
  { to: '/financials', label: 'Profit & Loss', module: 'financials' },
]

/** The hubs that draw their own tab row (not the settings ones). */
const TAB_HUBS: readonly (readonly HubTab[])[] = [TEAM_PEOPLE, TEAM_TIME, TEAM_PAY, MY_TIME, PROJECTS_HUB, MONEY]

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
