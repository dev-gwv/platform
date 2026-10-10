import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import {
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
  Receipt,
  ShieldCheck,
  Store,
  Activity,
  Megaphone,
  QrCode,
  Target,
  type LucideIcon,
} from 'lucide-react'
import type { ModuleKey } from '@ipc/permissions'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from '@/shared/ui/cn'

interface SettingsItem {
  to: string
  label: string
  icon: LucideIcon
  module: ModuleKey
  /** Other addresses that open this same page (old links, focused views). */
  also?: readonly string[]
  /** The vendor's own pages: shown only to a platform admin. */
  platformOnly?: boolean
  /**
   * Pages folded into this line, switched by a tab row on top of the page.
   * The first tab is this page. Each keeps its own address (and is listed in
   * `also` so the rail lights this line on it).
   */
  tabs?: readonly { to: string; label: string; module: ModuleKey }[]
}

interface SettingsGroup {
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
      {
        to: '/settings/company',
        label: 'Company profile',
        icon: Building2,
        module: 'settings',
        also: ['/settings/appearance'],
        tabs: [
          { to: '/settings/company', label: 'Company profile', module: 'settings' },
          { to: '/settings/appearance', label: 'Theme & branding', module: 'settings' },
        ],
      },
      {
        to: '/settings/attendance-location',
        label: 'Attendance',
        icon: MapPin,
        module: 'settings',
      },
      // Where the old app kept it: every studio's access, for the platform owner.
      { to: '/platform/studios', label: 'Studio Access Manager', icon: ShieldCheck, module: 'settings', platformOnly: true },
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
      // What changed across the studio. It was a line under the menu's "More".
      { to: '/activity', label: 'Activity', icon: Activity, module: 'settings' },
    ],
  },
  {
    label: 'Projects',
    items: [
      {
        to: '/settings/project-templates',
        label: 'Templates',
        icon: Briefcase,
        module: 'projects',
        also: ['/settings/task-bundles'],
        tabs: [
          { to: '/settings/project-templates', label: 'Project templates', module: 'projects' },
          { to: '/settings/task-bundles', label: 'Task bundles', module: 'settings' },
        ],
      },
      { to: '/project-documents', label: 'Documents', icon: FileText, module: 'projects' },
      { to: '/projects/stages', label: 'Delivery stages', icon: Layers, module: 'projects' },
    ],
  },
  {
    // Where enquiries come from: set up once, then they bring leads by themselves.
    label: 'Leads',
    items: [
      {
        to: '/enquiry-forms',
        label: 'Forms',
        icon: QrCode,
        module: 'crm',
        also: ['/settings/client-form'],
        tabs: [
          { to: '/enquiry-forms', label: 'Enquiry forms', module: 'crm' },
          { to: '/settings/client-form', label: 'Client details form', module: 'clients' },
        ],
      },
      { to: '/lead-sources', label: 'Lead sources', icon: Megaphone, module: 'lead_sources' },
      { to: '/referrals', label: 'Referrals', icon: Target, module: 'referrals' },
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
        also: ['/settings/refer-a-studio'],
        tabs: [
          { to: '/settings/subscription', label: 'Plan & billing', module: 'settings_subscription' },
          { to: '/settings/refer-a-studio', label: 'Refer a studio', module: 'settings_subscription' },
        ],
      },
    ],
  },
  {
    label: 'Messages & lists',
    items: [
      {
        to: '/settings/messaging',
        label: 'Messaging',
        icon: Bell,
        module: 'settings',
        also: ['/settings/whatsapp'],
        tabs: [
          { to: '/settings/messaging', label: 'Messages', module: 'settings' },
          { to: '/settings/whatsapp', label: 'WhatsApp', module: 'settings' },
        ],
      },
      {
        to: '/settings/lookups',
        label: 'Lists',
        icon: ListTree,
        module: 'settings',
        also: ['/settings/system', '/settings/services', '/settings/work-submissions'],
        tabs: [
          { to: '/settings/lookups', label: 'Lists', module: 'settings' },
          { to: '/settings/system', label: 'System', module: 'settings' },
        ],
      },
    ],
  },
]

const ALL_ITEMS = SETTINGS_GROUPS.flatMap((g) => g.items)

/** The same pages as a flat list, so the sidebar's Settings entry lights on all of them. */
// Roles and team terms light the Team menu's "Roles & terms" instead, and the
// plan lights its own "Plan & billing" line: two lit rows for one page reads
// as a bug.
export const SETTINGS_PAGES = ALL_ITEMS.filter(
  (i) => !['/settings/roles', '/settings/team-terms', '/settings/subscription'].includes(i.to),
).map(
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
    items: g.items
      .filter((i) => (!i.platformOnly || admin) && [i, ...(i.tabs ?? [])].some((t) => access.hasModule(t.module)))
      // A line whose first page this person cannot open goes to one they can.
      .map((i) => (access.hasModule(i.module) ? i : { ...i, to: i.tabs!.find((t) => access.hasModule(t.module))!.to })),
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
          value={groups.flatMap((g) => g.items).find((i) => i.label === current?.label)?.to ?? ''}
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
        // laptop screen the last group (Lookups, System) sits
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
              const on = current?.label === i.label
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

      <div className="min-w-0 flex-1">
        <SettingsTabs item={current} />
        {children}
      </div>
    </div>
  )
}

/** The tab row on a settings line that holds more than one page. */
function SettingsTabs({ item }: { item: SettingsItem | null }) {
  const { pathname } = useLocation()
  const access = useAccess()
  const tabs = (item?.tabs ?? []).filter((t) => access.hasModule(t.module))
  if (tabs.length < 2) return null
  const here = pathname.replace(/\/+$/, '')
  return (
    <nav
      aria-label="Pages in this setting"
      className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-card p-1"
    >
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          aria-current={here === t.to ? 'page' : undefined}
          className={cn(
            'whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            here === t.to ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
