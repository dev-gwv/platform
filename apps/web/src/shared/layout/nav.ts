import type { ModuleKey } from '@ipc/permissions'
import type { useAccess } from '../auth/useAccess'
import { SETTINGS_PAGES } from '@/features/settings/SettingsNav'
import { MONEY, MY_TIME, PLAN_BILLING, PROJECTS_HUB, TEAM_PAY, TEAM_PEOPLE, TEAM_SETUP, TEAM_TIME, type HubTab } from './hubs'
import { seesStudioWork, type AppRole } from '@ipc/permissions'
import {
  BarChart3,
  Gift,
  LifeBuoy,
  Mail,
  MapPin,
  Gauge,
  LayoutDashboard,
  KanbanSquare,
  CalendarClock,
  Database,
  Briefcase,
  ListChecks,
  Camera,
  ListTodo,
  CreditCard,
  Banknote,
  Wallet,
  TrendingUp,
  Contact,
  Inbox,
  Users,
  Clock,
  Settings,
  Lightbulb,
  Gem,
  ShieldCheck,
  Building2,
  IndianRupee,
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
  // Twelve lines for the studio, one word each (the audit, owner's yes):
  // Home · Leads · Clients · Projects · Shoots · Post-Production · Tasks ·
  // Data & Backup · Money · Team · Reports · Settings, and for the owner a
  // thirteenth, Plan & billing, just above Settings. Making something new is
  // the top bar's "+ New"; alerts are the bell; the occasional set-up pages
  // (enquiry forms, lead sources, referrals, activity) are in Settings.
  leaf('Home', '/dashboard', LayoutDashboard, { module: 'dashboard' }),

  // Employee-only personal set.
  // Their edits and their tasks on one page (My Tasks folded in; /tasks
  // still opens for anyone who has a link to it).
  leaf('My Work', '/my-work', ListTodo, { roles: ['employee'], badge: 'tasks-overdue' }),
  leaf('My Shoots', '/shoots/my', Camera, { roles: ['employee'] }),
  leaf('Attendance & leave', '/attendance/my', MapPin, { roles: ['employee'], hub: MY_TIME }),
  leaf('My payouts', '/payouts/my', Banknote, { roles: ['employee'] }),
  leaf('My performance', '/performance/me', Gauge, { roles: ['employee'] }),

  // The path stays /follow-ups: /leads already belongs to the lead_sources
  // module's route patterns, and every reminder and notification link
  // points here.
  leaf('Leads', '/follow-ups', Inbox, { module: 'crm' }),
  leaf('Clients', '/clients', Contact, { module: 'clients' }),
  // All projects, and a "Needs attention" tab (Project Tracking).
  leaf('Projects', '/projects', Briefcase, { module: 'projects', studioWork: true, hub: PROJECTS_HUB }),
  // One shoots page: Team Booking (Shoots · Calendar · People · Conflicts).
  leaf('Shoots', '/team-allocation', CalendarClock, { module: 'projects', studioWork: true }),
  leaf('Post-Production', '/production-board', KanbanSquare, { module: 'projects', studioWork: true }),
  // Reminders are a view of it now (?view=reminders).
  leaf('Tasks', '/tasks', ListChecks, { module: 'tasks' }),
  leaf('Data & Backup', '/data-management', Database, { module: 'projects', studioWork: true }),
  // Payments · Invoices · Expenses · Profit & Loss, one tab row.
  leaf('Money', '/billing/payments', IndianRupee, { hub: MONEY }),
  {
    kind: 'group',
    label: 'Team',
    icon: Users,
    match: '/employees',
    children: [
      // Four hubs, from nine links: each opens a page with its own tab row.
      leaf('People', '/employees', Users, { hub: TEAM_PEOPLE }),
      leaf('Attendance & leave', '/attendance', Clock, { hub: TEAM_TIME }),
      leaf('Pay', '/team-payouts', Wallet, { hub: TEAM_PAY }),
      leaf('Roles & terms', '/settings/roles', ShieldCheck, { hub: TEAM_SETUP }),
    ],
  },
  // How the studio is doing for a period: sales, money, delivery, team.
  leaf('Reports', '/reports', BarChart3, { module: 'reports' }),

  // The plan in sight (owner, 10 Oct): its own line for the owner, the only
  // one who can change it (settings_subscription is the owner's), above
  // Settings. The card at the foot of the sidebar keeps the days left.
  leaf('Plan & billing', '/settings/subscription', CreditCard, { module: 'settings_subscription', hub: PLAN_BILLING }),
  // Stays lit on every settings page, and search finds each one by name.
  leaf('Settings', '/settings/company', Settings, { module: 'settings', hub: SETTINGS_PAGES }),

  {
    kind: 'group',
    label: 'Platform',
    icon: Building2,
    match: '/platform',
    platformOnly: true,
    children: [
      leaf('Studio Access Manager', '/platform/studios', ShieldCheck, { platformOnly: true }),
      leaf('Plans', '/platform/plans', CreditCard, { platformOnly: true }),
      leaf('Usage', '/platform/usage', TrendingUp, { platformOnly: true }),
      leaf('Suggestions', '/platform/feedback', Lightbulb, { platformOnly: true }),
      leaf('Diamond claims', '/platform/diamond', Gem, { platformOnly: true }),
      leaf('Messaging', '/platform/messaging', MessageCircle, { platformOnly: true }),
      leaf('Email', '/platform/email', Mail, { platformOnly: true }),
      leaf('Help', '/platform/help', LifeBuoy, { platformOnly: true }),
      leaf('Studio referrals', '/platform/studio-referrals', Gift, { platformOnly: true }),
      leaf('Payments to check', '/platform/payments', CreditCard, { platformOnly: true }),
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

interface QuickLink extends NavLeaf {
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
const QUICK_TONES: { to: string; tone: QuickTone; label?: string }[] = [
  { to: '/follow-ups', tone: 'blue' },
  // Search finds the hub's first tab as "All projects"; the pill says Projects.
  { to: '/projects', tone: 'green', label: 'Projects' },
  { to: '/team-allocation', tone: 'violet' },
]

export function quickLinks(role: string, access: Access, isPlatformAdmin: boolean): QuickLink[] {
  const reachable = new Map(
    navDestinations(role, access, isPlatformAdmin).map((l) => [l.to, l] as const),
  )
  const out: QuickLink[] = []
  for (const { to, tone, label } of QUICK_TONES) {
    const leaf = reachable.get(to)
    if (leaf) out.push({ ...leaf, tone, ...(label ? { label } : {}) })
  }
  return out
}
