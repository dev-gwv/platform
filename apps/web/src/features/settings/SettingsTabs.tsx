import { Link, useLocation } from '@tanstack/react-router'
import type { ModuleKey } from '@ipc/permissions'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from '@/shared/ui/cn'

const TABS: ReadonlyArray<{ to: string; label: string; module: ModuleKey }> = [
  { to: '/settings/company', label: 'Company', module: 'settings' },
  { to: '/settings/roles', label: 'Roles & Access', module: 'team_roles' },
  { to: '/settings/task-bundles', label: 'Task Bundles', module: 'settings' },
  { to: '/settings/team-terms', label: 'Team Terms', module: 'team_terms' },
  { to: '/settings/appearance', label: 'Theme & Branding', module: 'settings' },
  { to: '/settings/lookups', label: 'Lookups', module: 'settings' },
  { to: '/settings/invoicing', label: 'Invoicing', module: 'billing' },
  { to: '/settings/attendance-location', label: 'Attendance Location', module: 'settings' },
  { to: '/settings/subscription', label: 'Subscription', module: 'settings_subscription' },
  { to: '/settings/system', label: 'System', module: 'settings' },
  { to: '/settings/advanced', label: 'Advanced', module: 'settings' },
]

/**
 * The settings pages are separate routes rather than one long page, so they
 * need something to say they belong together. Links, not state: each tab is a
 * real destination that survives a refresh and can be sent to someone.
 */
export function SettingsTabs() {
  const { pathname } = useLocation()
  const access = useAccess()
  const visible = TABS.filter((t) => access.hasModule(t.module))
  if (visible.length < 2) return null

  return (
    <div role="tablist" aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1.5">
      {visible.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          role="tab"
          aria-selected={pathname === t.to}
          className={cn(
            'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            pathname === t.to
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
