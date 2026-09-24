import type { StaffRole } from './roles'

/**
 * THE module registry — the single source of truth for both the frontend
 * (sidebar + route guard) and the backend (edge-router gates).
 *
 * The original build kept this list in two files that disagreed
 * (frontend accessModules.ts had 18 keys, backend permissions.ts had 28).
 * This package is imported by both sides so they cannot drift again.
 */
export type ModuleKey =
  | 'dashboard'
  | 'projects'
  | 'tasks'
  | 'clients'
  | 'team'
  | 'team_directory'
  | 'add_team_member'
  | 'team_work_preview'
  | 'team_terms'
  | 'team_roles'
  | 'money'
  | 'billing'
  | 'financials'
  | 'company_expenses'
  | 'personal_expenses'
  | 'attendance'
  | 'crm'
  | 'crm_export'
  | 'lead_sources'
  | 'lead_source_integration'
  | 'settings'
  | 'settings_subscription'
  | 'settings_security'
  | 'settings_integrations'
  | 'studio_access'
  | 'usage_analytics'
  | 'team_salaries'
  | 'employee_credentials'
  | 'referrals'
  | 'team_payouts'

export type ModuleAction = 'view' | 'create' | 'edit' | 'delete'

export interface ModuleDef {
  key: ModuleKey
  label: string
  /** Primary sidebar destination, if the module has a landing screen. */
  path?: string
  /** Route prefixes owned by this module — used by the frontend route guard. */
  routePatterns: ReadonlyArray<string>
  /** High-sensitivity (finance / platform / studio config). Drives extra gating. */
  sensitive: boolean
  /** Default visibility per staff role. Owner (super_admin) bypasses this map entirely. */
  defaultVisibility: Readonly<Record<StaffRole, boolean>>
  /** When true, NO staff role gets it by default — only owner or an explicit grant. */
  superAdminOnly?: boolean
}

const allow = (admin: boolean, manager: boolean, employee: boolean) => ({ admin, manager, employee })

export const MODULES: Readonly<Record<ModuleKey, ModuleDef>> = {
  dashboard: {
    key: 'dashboard',
    label: 'Dashboard',
    path: '/dashboard',
    routePatterns: ['/dashboard'],
    sensitive: false,
    defaultVisibility: allow(true, true, true),
  },
  projects: {
    key: 'projects',
    label: 'Projects',
    path: '/projects',
    routePatterns: [
      '/projects',
      '/shoots',
      '/tasks',
      '/team-allocation',
      '/data-management',
      '/project-documents',
      '/my-work',
    ],
    sensitive: false,
    defaultVisibility: allow(true, true, true),
  },
  tasks: {
    key: 'tasks',
    label: 'Tasks',
    routePatterns: [],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },
  clients: {
    key: 'clients',
    label: 'Clients',
    path: '/clients',
    routePatterns: ['/clients', '/enquiries'],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },
  team: {
    key: 'team',
    label: 'Team',
    path: '/employees',
    routePatterns: ['/employees'],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },
  team_directory: {
    key: 'team_directory',
    label: 'Team Directory',
    path: '/employees',
    routePatterns: ['/employees'],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },
  add_team_member: {
    key: 'add_team_member',
    label: 'Add Team Member',
    path: '/employees/new',
    routePatterns: ['/employees/new'],
    sensitive: false,
    defaultVisibility: allow(true, false, false),
  },
  team_work_preview: {
    key: 'team_work_preview',
    label: 'Team Work Preview',
    path: '/team/work-preview',
    routePatterns: ['/team/work-preview'],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },
  team_terms: {
    key: 'team_terms',
    label: 'Team Terms',
    path: '/team/team-terms',
    routePatterns: ['/team/team-terms', '/settings/team-terms'],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },
  team_roles: {
    key: 'team_roles',
    label: 'Roles & Access',
    path: '/settings/roles',
    routePatterns: ['/settings/roles', '/team/roles'],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },
  attendance: {
    key: 'attendance',
    label: 'Attendance',
    path: '/attendance',
    routePatterns: ['/attendance'],
    sensitive: true,
    defaultVisibility: allow(true, false, false),
  },
  crm: {
    key: 'crm',
    label: 'CRM',
    path: '/follow-ups',
    routePatterns: ['/follow-ups', '/reminders', '/crm'],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },
  lead_sources: {
    key: 'lead_sources',
    label: 'Lead Sources',
    path: '/facebook',
    routePatterns: ['/leads', '/facebook'],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },

  // ── Sensitive: owner-only by default ──────────────────────────
  money: {
    key: 'money',
    label: 'Billing',
    path: '/billing',
    routePatterns: ['/billing', '/company-expenses', '/financials'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  billing: {
    key: 'billing',
    label: 'Billing',
    path: '/billing',
    routePatterns: ['/billing'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  financials: {
    key: 'financials',
    label: 'Financials',
    path: '/financials',
    routePatterns: ['/financials'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  company_expenses: {
    key: 'company_expenses',
    label: 'Company Expenses',
    path: '/company-expenses',
    routePatterns: ['/company-expenses'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  personal_expenses: {
    key: 'personal_expenses',
    label: 'Personal Expenses',
    path: '/company-expenses',
    // Folded into Expenses (0170). The key stays because saved role
    // permissions still name it; it no longer owns a screen.
    routePatterns: [],
    sensitive: false,
    defaultVisibility: allow(true, true, true),
  },
  team_salaries: {
    key: 'team_salaries',
    label: 'Team Salaries',
    routePatterns: [],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  employee_credentials: {
    key: 'employee_credentials',
    label: 'Employee Credentials',
    routePatterns: [],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  crm_export: {
    key: 'crm_export',
    label: 'CRM Export',
    routePatterns: [],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  lead_source_integration: {
    key: 'lead_source_integration',
    label: 'Lead Source Integration',
    routePatterns: [],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  settings: {
    key: 'settings',
    label: 'Settings',
    path: '/settings/company',
    routePatterns: [],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  settings_subscription: {
    key: 'settings_subscription',
    label: 'Subscription',
    path: '/settings/subscription',
    routePatterns: ['/settings/subscription'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  settings_security: {
    key: 'settings_security',
    label: 'Security',
    path: '/settings/security',
    routePatterns: ['/settings/security'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  settings_integrations: {
    key: 'settings_integrations',
    label: 'Integrations',
    path: '/settings/integrations',
    routePatterns: ['/settings/integrations'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  studio_access: {
    key: 'studio_access',
    label: 'Studio Access',
    path: '/platform/studios',
    routePatterns: ['/platform/studios'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  usage_analytics: {
    key: 'usage_analytics',
    label: 'Usage Analytics',
    path: '/platform/usage',
    routePatterns: ['/platform/usage'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
  referrals: {
    key: 'referrals',
    label: 'Referrals',
    path: '/referrals',
    routePatterns: ['/referrals'],
    sensitive: false,
    defaultVisibility: allow(true, true, false),
  },
  team_payouts: {
    key: 'team_payouts',
    label: 'Team Payouts',
    path: '/team-payouts',
    routePatterns: ['/team-payouts'],
    sensitive: true,
    defaultVisibility: allow(false, false, false),
    superAdminOnly: true,
  },
}

export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[]

/** Modules whose direct-URL access is blocked at the frontend route guard. */
export const ROUTE_GUARDED_MODULES: ReadonlyArray<ModuleKey> = [
  'money',
  'billing',
  'financials',
  'company_expenses',
  'lead_sources',
  'lead_source_integration',
  'crm',
  'crm_export',
  'team_terms',
  'team_roles',
  'settings',
  'settings_subscription',
  'settings_security',
  'settings_integrations',
  'studio_access',
  'usage_analytics',
]

/** Resolve a pathname to the first module whose patterns match it. */
export function moduleForPath(pathname: string): ModuleDef | null {
  for (const mod of Object.values(MODULES)) {
    for (const pat of mod.routePatterns) {
      if (pathname === pat || pathname.startsWith(pat + '/')) return mod
    }
  }
  return null
}
