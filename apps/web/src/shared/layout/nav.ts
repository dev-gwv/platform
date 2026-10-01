import type { ModuleKey } from '@ipc/permissions'
import type { useAccess } from '../auth/useAccess'
import { SETTINGS_PAGES } from '@/features/settings/SettingsNav'
import { MY_TIME, TEAM_PAY, TEAM_PEOPLE, TEAM_SETUP, TEAM_TIME, type HubTab } from './hubs'
import { seesStudioWork, type AppRole } from '@ipc/permissions'
import {
  BarChart3,
  Mail,
  MapPin,
  Gauge,
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
  QrCode,
  Users,
  Clock,
  Settings,
  Lightbulb,
  Gem,
  ShieldCheck,
  Building2,
  Activity,
  IndianRupee,
  Ellipsis,
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
  /**
   * The pages this entry stands for (hubs.ts). It shows while any of them
   * can be opened, links to the first that can, and stays lit on all of them.
   */
  hub?: readonly HubTab[]
  /**
   * The studio's work -- every project, the booking calendar, the data book.
   * Hidden from staff, who see their own work (seesStudioWork).
   */
  studioWork?: boolean
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
  leaf('Dashboard', '/dashboard', LayoutDashboard, { module: 'dashboard', roles: ['super_admin', 'admin', 'manager', 'platform_admin'] }),
  // Staff: the same page is their day -- what to do today and what is next.
  leaf('Home', '/dashboard', LayoutDashboard, { module: 'dashboard', roles: ['employee'] }),
  // How the studio is doing for a period: sales, money, delivery, team.
  leaf('Reports', '/reports', BarChart3, { module: 'reports' }),

  // Employee-only personal set.
  leaf('My Work', '/my-work', ListTodo, { roles: ['employee'] }),
  // The same page as Task Management, showing only their own: where they
  // submit work and see what was sent back.
  leaf('My Tasks', '/tasks', ListTodo, { roles: ['employee'], badge: 'tasks-overdue' }),
  leaf('My Shoots', '/shoots/my', Camera, { roles: ['employee'] }),
  leaf('Attendance & leave', '/attendance/my', MapPin, { roles: ['employee'], hub: MY_TIME }),
  leaf('My performance', '/performance/me', Gauge, { roles: ['employee'] }),

  {
    kind: 'group',
    label: 'Production',
    icon: KanbanSquare,
    match: '/production',
    children: [
      leaf('Production Board', '/production-board', KanbanSquare, { module: 'projects', studioWork: true }),
      leaf('Team Booking', '/team-allocation', CalendarClock, { module: 'projects', studioWork: true }),
      leaf('Data & Backup', '/data-management', Database, { module: 'projects', studioWork: true }),
    ],
  },
  {
    kind: 'group',
    label: 'Projects',
    icon: Briefcase,
    match: '/projects',
    children: [
      leaf('All Projects', '/projects', Briefcase, { module: 'projects', studioWork: true }),
      leaf('Create Project', '/projects/new', Plus, { module: 'projects', studioWork: true }),
      leaf('Project Tracking', '/project-tracking', Target, { module: 'projects', studioWork: true }),
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
      // A QR per vendor; its leads are credited to them (0195).
      leaf('Enquiry forms', '/enquiry-forms', QrCode, { module: 'crm' }),
      leaf('Lead Sources', '/lead-sources', Megaphone, { module: 'lead_sources' }),
    ],
  },
  {
    kind: 'group',
    label: 'Team',
    icon: Users,
    match: '/employees',
    children: [
      // Four hubs, from nine links: each opens a page with its own tab row.
      leaf('People', '/employees', Users, { hub: TEAM_PEOPLE }),
      leaf('Attendance & leave', '/attendance', Clock, { hub: TEAM_TIME }),
      leaf('Pay', '/payroll', IndianRupee, { hub: TEAM_PAY }),
      leaf('Roles & terms', '/settings/roles', ShieldCheck, { hub: TEAM_SETUP }),
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
      leaf('Activity', '/activity', Activity, { studioWork: true }),
      leaf('Referrals', '/referrals', Target, { module: 'referrals' }),
    ],
  },

  // The studio's plan is not a menu line any more: it is the card pinned at
  // the foot of the sidebar (PlanCard), with its days left and an Upgrade
  // button always in sight. Settings > Plan & billing opens the same page.
  // Stays lit on every settings page, and search finds each one by name.
  leaf('Settings', '/settings/company', Settings, { module: 'settings', hub: SETTINGS_PAGES }),

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
      leaf('Diamond claims', '/platform/diamond', Gem, { platformOnly: true }),
      leaf('Messaging', '/platform/messaging', MessageCircle, { platformOnly: true }),
      leaf('Email', '/platform/email', Mail, { platformOnly: true }),
    ],
  },
]

function leafVisible(
  leaf: NavLeaf,
  role: string,
  access: Access,
  isPlatformAdmin: boolean,
): boolean {
  if (leaf.platformOnly) return isPlatformAdmin
  if (leaf.hub && !leaf.hub.some((t) => access.hasModule(t.module))) return false
  if (leaf.roles && !leaf.roles.includes(role as never)) return false
  if (leaf.module && !access.hasModule(leaf.module as ModuleKey)) return false
  if (leaf.studioWork && !seesStudioWork(access)) return false
  return true
}

/** A hub entry keeps only the pages this person can open, and links to the first. */
function narrowHub(leaf: NavLeaf, access: Access): NavLeaf {
  if (!leaf.hub) return leaf
  const hub = leaf.hub.filter((t) => access.hasModule(t.module))
  return { ...leaf, hub, to: hub[0]?.to ?? leaf.to }
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
      if (leafVisible(e, role, access, isPlatformAdmin)) out.push(narrowHub(e, access))
    } else {
      if (e.platformOnly && !isPlatformAdmin) continue
      if (e.roles && !e.roles.includes(role as never)) continue
      const children = e.children
        .filter((c) => leafVisible(c, role, access, isPlatformAdmin))
        .map((c) => narrowHub(c, access))
      if (children.length) out.push({ ...e, children })
    }
  }
  return out
}

/** Every destination this user can actually open, flattened for searching. */
export function navDestinations(role: string, access: Access, isPlatformAdmin: boolean): NavLeaf[] {
  const out: NavLeaf[] = []
  // A hub is searched as its pages, so "Payroll" or "Leave" still finds its page.
  const add = (l: NavLeaf) => {
    if (!l.hub) return out.push(l)
    for (const t of l.hub)
      out.push({ kind: 'leaf', label: t.label, to: t.to, ...(l.icon ? { icon: l.icon } : {}) })
  }
  for (const e of filterNav(NAV, role, access, isPlatformAdmin)) {
    if (e.kind === 'leaf') add(e)
    else e.children.forEach(add)
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
