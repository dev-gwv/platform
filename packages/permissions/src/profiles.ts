import type { ModuleKey } from './modules'

/**
 * System profiles — the "badges" a studio owner can hand out.
 * Held as code constants (not DB rows) so both sides resolve them identically.
 * Custom assignments and per-permission overrides DO live in the DB
 * (`user_access_assignments`, `user_access_overrides`).
 */
export interface SystemProfile {
  key: string
  label: string
  description: string
  /** For UX display only. */
  accessLevel: 'admin' | 'manager' | 'employee' | 'custom'
  /** Module keys (View) and "{module}.{action}" keys (create / edit / delete). */
  permissions: ReadonlyArray<string>
}

/**
 * A profile that runs an area can change things in it, not only look. A bare
 * module key only grants View, so a "Project Manager" used to lose the right
 * to create or edit projects the moment it was assigned. The dashboard is
 * read-only everywhere.
 */
const withWrites = (keys: ReadonlyArray<ModuleKey>): string[] => [
  ...keys,
  ...keys.filter((k) => k !== 'dashboard').flatMap((k) => [`${k}.create`, `${k}.edit`, `${k}.delete`]),
]

const BASE_EMPLOYEE: ReadonlyArray<ModuleKey> = ['dashboard', 'projects']

const BASE_MANAGER: ReadonlyArray<ModuleKey> = [
  ...BASE_EMPLOYEE,
  'clients',
  'team',
  'team_directory',
  'team_work_preview',
  'team_terms',
  'team_roles',
  'crm',
  'lead_sources',
]

export const SYSTEM_PROFILES: Readonly<Record<string, SystemProfile>> = {
  project_manager: {
    key: 'project_manager',
    label: 'Project Manager',
    description: 'Projects, team, clients, CRM. No money, no settings.',
    accessLevel: 'manager',
    permissions: withWrites(BASE_MANAGER),
  },
  finance_manager: {
    key: 'finance_manager',
    label: 'Finance Manager',
    description: 'Money, billing, finance, company expenses. No team admin.',
    accessLevel: 'custom',
    // Payroll is finance work: salaries and payouts come with it.
    permissions: [
      ...BASE_EMPLOYEE,
      ...withWrites(['clients', 'money', 'billing', 'financials', 'company_expenses', 'team_salaries', 'team_payouts']),
    ],
  },
  crm_executive: {
    key: 'crm_executive',
    label: 'CRM Executive',
    description: 'CRM + lead sources + clients only.',
    accessLevel: 'custom',
    permissions: [...BASE_EMPLOYEE, ...withWrites(['clients', 'crm', 'lead_sources'])],
  },
  team_manager: {
    key: 'team_manager',
    label: 'Team Manager',
    description: 'Team directory, terms, roles, allocation. No money.',
    accessLevel: 'manager',
    permissions: [
      ...BASE_EMPLOYEE,
      ...withWrites(['team', 'team_directory', 'team_work_preview', 'team_terms', 'team_roles', 'attendance']),
    ],
  },
  photographer: {
    key: 'photographer',
    label: 'Photographer / Freelancer',
    description: 'Personal dashboard, assigned projects, expenses.',
    accessLevel: 'employee',
    permissions: BASE_EMPLOYEE,
  },
  custom_admin: {
    key: 'custom_admin',
    label: 'Custom Admin',
    description: 'Start from base manager, then customise with overrides.',
    accessLevel: 'custom',
    permissions: withWrites(BASE_MANAGER),
  },
}

export function getProfile(key: string | null | undefined): SystemProfile | null {
  if (!key) return null
  return SYSTEM_PROFILES[key] ?? null
}
