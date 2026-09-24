import { Link } from '@tanstack/react-router'
import { Camera, ChevronRight, Eye, Facebook, FileText, FileSignature, MapPin, Shield, BarChart3, Users } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'

export function AdvancedSettingsPage() {
  return (
    <AuthedPage module="settings">
      <Advanced />
    </AuthedPage>
  )
}

/**
 * Lovable parity (/settings/advanced): secondary tools and admin utilities.
 * Daily workflows stay in the sidebar; this hub links to existing
 * dialogs/pages so nothing is a dead end.
 */
function Advanced() {
  const { session } = useAuth()
  const access = useAccess()
  const isOwner = session?.is_owner ?? false
  const isAdmin = session?.role === 'admin' || session?.role === 'super_admin' || isOwner
  const isManager = isAdmin || session?.role === 'manager'

  const tools: Array<{ to: string; title: string; desc: string; icon: typeof FileText; show: boolean }> = [
    { to: '/project-documents', title: 'Project Documents', desc: 'Track signed agreements and project paperwork.', icon: FileText, show: access.hasModule('projects') },
    { to: '/shoots', title: 'Shoots', desc: 'Browse all shoots across every project.', icon: Camera, show: isManager },
    { to: '/settings/team-terms', title: 'Team Terms', desc: 'Manage acknowledged team terms and versions.', icon: FileSignature, show: access.hasModule('projects') },
    { to: '/team/work-preview', title: 'Team Work Preview', desc: 'Preview team submissions before sharing.', icon: Eye, show: access.hasModule('projects') },
    { to: '/settings/attendance-location', title: 'Attendance Location', desc: 'Configure office location for attendance check-in.', icon: MapPin, show: isAdmin },
    { to: '/platform/studios', title: 'Studio Access', desc: 'Platform-level studio management.', icon: Shield, show: session?.is_platform_admin ?? false },
    { to: '/platform/usage', title: 'Usage Analytics', desc: 'Platform-level usage and analytics.', icon: BarChart3, show: session?.is_platform_admin ?? false },
    { to: '/lead-sources', title: 'Facebook Import Log', desc: 'Recent leads imported from Facebook.', icon: Facebook, show: access.hasModule('settings') },
    { to: '/settings/system', title: 'Source Logs', desc: 'Audit log and scheduled-job history.', icon: Users, show: isAdmin },
  ]
  const visible = tools.filter((t) => t.show)

  return (
    <>
      <PageHeader title="Advanced Tools" description="Secondary tools and admin utilities. Daily workflows remain in the main sidebar." />
      <SettingsTabs />
      {visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No advanced tools available for your role.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((t) => {
            const Icon = t.icon
            return (
              <Link
                key={t.to}
                to={t.to}
                className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary/50 hover:shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.desc}</p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
