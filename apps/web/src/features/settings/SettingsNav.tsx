import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Gift,
  Bell,
  Building2,
  Briefcase,
  ClipboardList,
  CreditCard,
  FileSignature,
  FileText,
  Layers,
  ListTree,
  MapPin,
  MessageCircle,
  Package,
  Palette,
  Receipt,
  ServerCog,
  ShieldCheck,
  Store,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ModuleKey } from '@ipc/permissions'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from '@/shared/ui/cn'

export interface SettingsItem {
  to: string
  label: string
  icon: LucideIcon
  module: ModuleKey
  /** Other addresses that open this same page (old links, focused views). */
  also?: readonly string[]
  /** The vendor's own pages: shown only to a platform admin. */
  platformOnly?: boolean
}

export interface SettingsGroup {
  label: string
  items: readonly SettingsItem[]
}

/**
 * Every settings page, in six short groups.
 *
 * This replaced a strip of sixteen tabs that scrolled sideways. The owner:
 * "if a person is moving to the settings tab, he will be drained to see all
 * these different tabs." Nothing was taken away: each page keeps its own
 * address, and each group holds at most four, so the eye reads a heading and
 * stops, the way Stripe's and Linear's settings read.
 */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    label: 'Studio',
    items: [
      { to: '/settings/company', label: 'Company profile', icon: Building2, module: 'settings' },
      { to: '/settings/appearance', label: 'Theme & branding', icon: Palette, module: 'settings' },
      {
        to: '/settings/attendance-location',
        label: 'Attendance',
        icon: MapPin,
        module: 'settings',
      },
    ],
  },
  {
    label: 'Team',
    items: [
      { to: '/settings/roles', label: 'Roles & access', icon: ShieldCheck, module: 'team_roles' },
      {
        to: '/settings/team-terms',
        label: 'Team terms',
        icon: FileSignature,
        module: 'team_terms',
      },
    ],
  },
  {
    label: 'Projects',
    items: [
      {
        to: '/settings/project-templates',
        label: 'Project templates',
        icon: Briefcase,
        module: 'projects',
      },
      { to: '/project-documents', label: 'Documents', icon: FileText, module: 'projects' },
      { to: '/projects/stages', label: 'Delivery stages', icon: Layers, module: 'projects' },
      { to: '/settings/task-bundles', label: 'Task bundles', icon: Package, module: 'settings' },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/settings/invoicing', label: 'Invoicing', icon: Receipt, module: 'billing' },
      { to: '/settings/vendors', label: 'Vendors', icon: Store, module: 'company_expenses' },
      {
        to: '/settings/subscription',
        label: 'Plan & billing',
        icon: CreditCard,
        module: 'settings_subscription',
      },
      { to: '/settings/refer-a-studio', label: 'Refer a studio', icon: Gift, module: 'settings_subscription' },
    ],
  },
  {
    label: 'Messages',
    items: [
      { to: '/settings/messaging', label: 'Messaging', icon: Bell, module: 'settings' },
      { to: '/settings/whatsapp', label: 'WhatsApp', icon: MessageCircle, module: 'settings' },
      { to: '/settings/client-form', label: 'Client details form', icon: ClipboardList, module: 'clients' },
    ],
  },
  {
    label: 'More',
    items: [
      { to: '/settings/lookups', label: 'Lookups', icon: ListTree, module: 'settings' },
      {
        to: '/settings/system',
        label: 'System',
        icon: ServerCog,
        module: 'settings',
        also: ['/settings/services', '/settings/work-submissions'],
      },
      { to: '/settings/advanced', label: 'Advanced tools', icon: Wrench, module: 'settings' },
      // Where the old app kept it: every studio's access, for the platform owner.
      { to: '/platform/studios', label: 'Studio Access Manager', icon: ShieldCheck, module: 'settings', platformOnly: true },
    ],
  },
]

const ALL_ITEMS = SETTINGS_GROUPS.flatMap((g) => g.items)

/** The same pages as a flat list, so the sidebar's Settings entry lights on all of them. */
// Roles and team terms light the Team menu's "Roles & terms" instead: two lit
// rows for one page reads as a bug.
export const SETTINGS_PAGES = ALL_ITEMS.filter((i) => !['/settings/roles', '/settings/team-terms'].includes(i.to)).map(
  ({ to, label, module }) => ({ to, label, module }),
)

/** The settings page this address belongs to, if it is one. */
export function settingsItemFor(pathname: string): SettingsItem | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  return ALL_ITEMS.find((i) => i.to === p || i.also?.includes(p)) ?? null
}

function useVisibleGroups() {
  const access = useAccess()
  const admin = useAuth().session?.is_platform_admin ?? false
  return SETTINGS_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => access.hasModule(i.module) && (!i.platformOnly || admin)),
  })).filter((g) => g.items.length > 0)
}

/**
 * The frame every settings page sits in: the grouped rail on the left, the
 * page on the right. On a phone the rail folds into one picker at the top.
 * Someone who can open only one settings page gets the page alone.
 */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const groups = useVisibleGroups()
  const current = settingsItemFor(pathname)
  const count = groups.reduce((n, g) => n + g.items.length, 0)
  if (count < 2) return <>{children}</>

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <label className="md:hidden">
        <span className="sr-only">Settings page</span>
        <select
          value={current?.to ?? ''}
          onChange={(e) => void navigate({ to: e.target.value })}
          className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-medium"
        >
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => (
                <option key={i.to} value={i.to}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <nav
        aria-label="Settings"
        // Pinned while the page scrolls, so it carries its own scroll: on a
        // laptop screen the More group (Lookups, System, Studio access) sits
        // below the fold and could not be reached.
        className="sticky top-0 hidden max-h-[calc(100dvh-9rem)] w-52 shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-3 md:flex"
      >
        <p className="flex items-center gap-2 px-2 text-sm font-semibold">
          <ClipboardList className="size-4 text-muted-foreground" aria-hidden /> Settings
        </p>
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5">
            <p className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {g.label}
            </p>
            {g.items.map((i) => {
              const on = current?.to === i.to
              const Icon = i.icon
              return (
                <Link
                  key={i.to}
                  to={i.to}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
                    on
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {i.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
