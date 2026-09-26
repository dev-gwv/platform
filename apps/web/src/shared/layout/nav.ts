import type { ModuleKey } from '@ipc/permissions'
import type { useAccess } from '../auth/useAccess'
import type { AppRole } from '@ipc/permissions'
import {
  BarChart3,
  CalendarOff,
  LayoutDashboard,
  KanbanSquare,
  CalendarClock,
  Database,
  Briefcase,
  Plus,
  Target,
  ListChecks,
  Camera,
  ListTodo,
  CreditCard,
  Receipt,
  Banknote,
  Wallet,
  TrendingUp,
  Contact,
  Inbox,
  Bell,
  Megaphone,
  Users,
  Clock,
  Settings,
  Lightbulb,
  ShieldCheck,
  Building2,
  Activity,
  DollarSign,
  FileSignature,
  Eye,
  Ellipsis,
  HandCoins,
  type LucideIcon,
  MessageCircle,
} from 'lucide-react'

export interface NavLeaf {
  kind: 'leaf'
  label: string
  to: string
  icon?: LucideIcon
  module?: ModuleKey
  roles?: AppRole[]
  /** Cross-tenant vendor console — gated on platform_admins, NOT a module. */
  platformOnly?: boolean
  /** A live count beside the label (the viewer's overdue tasks). */
  badge?: 'tasks-overdue'
}

export interface NavGroup {
  kind: 'group'
  label: string
  icon?: LucideIcon
  /** Path prefix that auto-opens this group. */
  match: string
  children: NavLeaf[]
  roles?: AppRole[]
  /** Cross-tenant vendor console — gated on platform_admins, NOT a module. */
  platformOnly?: boolean
}

export type NavEntry = NavLeaf | NavGroup

type Access = ReturnType<typeof useAccess>

const leaf = (
  label: string,
  to: string,
  icon: LucideIcon,
  extra: Partial<NavLeaf> = {},
): NavLeaf => ({ kind: 'leaf', label, to, icon, ...extra })

/**
 * The single sidebar source. Trimming here is cosmetic — hidden routes are
 * still guarded by ModuleRouteGuard + the API. Employees get a flat personal
 * set; admins/managers get workflow groups.
 */
export const NAV: NavEntry[] = [
  leaf('Dashboard', '/dashboard', LayoutDashboard, { module: 'dashboard' }),
  // How the studio is doing for a period: sales, money, delivery, team.
  leaf('Reports', '/reports', BarChart3, { module: 'reports' }),

  // Employee-only personal set.
  leaf('My Work', '/my-work', ListTodo, { roles: ['employee'] }),
  // The same page as Task Management, showing only their own: where they
  // submit work and see what was sent back.
  leaf('My Tasks', '/tasks', ListTodo, { roles: ['employee'], badge: 'tasks-overdue' }),
  leaf('My Shoots', '/shoots/my', Camera, { roles: ['employee'] }),
  leaf('Leave', '/leave', CalendarOff, { roles: ['employee'] }),

  {
    kind: 'group',
    label: 'Production',
    icon: KanbanSquare,
    match: '/production',
    children: [
      leaf('Production Board', '/production-board', KanbanSquare, { module: 'projects' }),
      leaf('Team Booking', '/team-allocation', CalendarClock, { module: 'projects' }),
      leaf('Data & Backup', '/data-management', Database, { module: 'projects' }),
    ],
  },
  {
    kind: 'group',
    label: 'Projects',
    icon: Briefcase,
    match: '/projects',
    children: [
      leaf('All Projects', '/projects', Briefcase, { module: 'projects' }),
      leaf('Create Project', '/projects/new', Plus, { module: 'projects' }),
      leaf('Project Tracking', '/project-tracking', Target, { module: 'projects' }),
      // Templates, documents and delivery stages are set up once and then left
      // alone, so they live under Settings rather than in the daily menu.
    ],
  },

  leaf('Task Management', '/tasks', ListChecks, { module: 'tasks', badge: 'tasks-overdue' }),

  {
    kind: 'group',
    label: 'Billing',
    icon: CreditCard,
    match: '/billing',
    children: [
      // Four heads, like the old app: what is owed, what came in, what went
      // out, what is left. Invoice settings live under Settings.
      leaf('Invoices', '/billing/invoices', Receipt, { module: 'billing' }),
      leaf('Payments received', '/billing/payments', Banknote, { module: 'billing' }),
      leaf('Expenses', '/company-expenses', Wallet, { module: 'company_expenses' }),
      leaf('Profit & Loss', '/financials', TrendingUp, { module: 'financials' }),
    ],
  },
  {
    kind: 'group',
    label: 'CRM & Clients',
    icon: Contact,
    match: '/clients',
    children: [
      // Three, from six. Enquiries was the same list one step earlier -- an
      // unworked enquiry is now a lead wearing an "Uncontacted" badge (0168).
      // Contacts and Companies were an org-chart layer on a business whose
      // customer is a family; what they held lives on the lead itself.
      //
      // The path stays /follow-ups: /leads already belongs to the lead_sources
      // module's route patterns, and every reminder and notification link
      // points here.
      leaf('Leads', '/follow-ups', Inbox, { module: 'crm' }),
      leaf('Clients', '/clients', Contact, { module: 'clients' }),
      leaf('Lead Sources', '/lead-sources', Megaphone, { module: 'lead_sources' }),
    ],
  },
  {
    kind: 'group',
    label: 'Team',
    icon: Users,
    match: '/employees',
    children: [
      leaf('Team Directory', '/employees', Users, { module: 'team_directory' }),
      leaf('Attendance', '/attendance', Clock, { module: 'attendance' }),
      leaf('Leave & Holidays', '/leave', CalendarOff, { module: 'attendance' }),
      leaf('Roles & Access', '/settings/roles', ShieldCheck, { module: 'team_roles' }),
      leaf('Team Terms', '/settings/team-terms', FileSignature, { module: 'team_terms' }),
      leaf('Payroll', '/payroll', HandCoins, { module: 'team_salaries' }),
      leaf('Team Payouts', '/team-payouts', DollarSign, { module: 'team_payouts' }),
      leaf('Work Preview', '/team/work-preview', Eye, { module: 'team_work_preview' }),
    ],
  },

  // The occasional destinations, behind one heading. Six loose rows here made
  // the menu read as six more things a new studio had to learn before it
  // could start; none is part of setting a studio up, and the two most urgent
  // (alerts and reminders) also live on the bell in the header.
  {
    kind: 'group',
    label: 'More',
    icon: Ellipsis,
    match: '/activity',
    children: [
      // Alerts and reminders reach everyone: overdue follow-ups land on
      // whoever owns them, CRM module or not.
      leaf('Alerts', '/notifications', Bell),
      leaf('Reminders', '/reminders', Bell),
      // Activity trail: see what's changed across the studio.
      leaf('Activity', '/activity', Activity),
      leaf('Referrals', '/referrals', Target, { module: 'referrals' }),
    ],
  },

  leaf('Settings', '/settings/company', Settings, { module: 'settings' }),

  {
    kind: 'group',
    label: 'Platform',
    icon: Building2,
    match: '/platform',
    platformOnly: true,
    children: [
      leaf('Studios', '/platform/studios', Building2, { platformOnly: true }),
      leaf('Usage', '/platform/usage', TrendingUp, { platformOnly: true }),
      leaf('Suggestions', '/platform/feedback', Lightbulb, { platformOnly: true }),
      leaf('Messaging', '/platform/messaging', MessageCircle, { platformOnly: true }),
    ],
  },
]

function leafVisible(leaf: NavLeaf, role: string, access: Access, isPlatformAdmin: boolean): boolean {
  if (leaf.platformOnly) return isPlatformAdmin
  if (leaf.roles && !leaf.roles.includes(role as never)) return false
  if (leaf.module && !access.hasModule(leaf.module as ModuleKey)) return false
  return true
}

/** Drop entries failing role/module/platform checks; drop groups left empty. */
export function filterNav(
  entries: NavEntry[],
  role: string,
  access: Access,
  isPlatformAdmin: boolean,
): NavEntry[] {
  const out: NavEntry[] = []
  for (const e of entries) {
    if (e.kind === 'leaf') {
      if (leafVisible(e, role, access, isPlatformAdmin)) out.push(e)
    } else {
      if (e.platformOnly && !isPlatformAdmin) continue
      if (e.roles && !e.roles.includes(role as never)) continue
      const children = e.children.filter((c) => leafVisible(c, role, access, isPlatformAdmin))
      if (children.length) out.push({ ...e, children })
    }
  }
  return out
}

/** Every destination this user can actually open, flattened for searching. */
export function navDestinations(
  role: string,
  access: Access,
  isPlatformAdmin: boolean,
): NavLeaf[] {
  const out: NavLeaf[] = []
  for (const e of filterNav(NAV, role, access, isPlatformAdmin)) {
    if (e.kind === 'leaf') out.push(e)
    else out.push(...e.children)
  }
  return out
}

/** The hue a header shortcut wears. Cosmetic only — see --tone-* in styles.css. */
export type QuickTone = 'blue' | 'green' | 'violet'

export interface QuickLink extends NavLeaf {
  tone: QuickTone
}

/**
 * The handful of destinations that earn a one-click pill in the header.
 *
 * Only the path and the hue live here: the label and icon are read back out of
 * NAV, so a pill can never drift from the sidebar row it shadows, and a
 * destination that gets renamed or re-iconed is renamed in both places at
 * once. A path with no NAV entry — or one this account cannot reach — drops
 * out rather than rendering a pill that 403s.
 */
const QUICK_TONES: { to: string; tone: QuickTone }[] = [
  { to: '/team-allocation', tone: 'blue' },
  { to: '/projects', tone: 'green' },
  { to: '/project-tracking', tone: 'violet' },
]

export function quickLinks(role: string, access: Access, isPlatformAdmin: boolean): QuickLink[] {
  const reachable = new Map(
    navDestinations(role, access, isPlatformAdmin).map((l) => [l.to, l] as const),
  )
  const out: QuickLink[] = []
  for (const { to, tone } of QUICK_TONES) {
    const leaf = reachable.get(to)
    if (leaf) out.push({ ...leaf, tone })
  }
  return out
}
