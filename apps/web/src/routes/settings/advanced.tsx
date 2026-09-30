import { Link } from '@tanstack/react-router'
import { Camera, ChevronRight, Eye, Facebook, Shield, BarChart3, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'

export function AdvancedSettingsPage() {
  return (
    <AuthedPage module="settings">
      <Advanced />
    </AuthedPage>
  )
}

/**
 * The tools that have no other home. It used to repeat Documents, Team terms,
 * Attendance location and the System page as well; those are in the settings
 * rail now, so listing them twice only made the page longer.
 */
function Advanced() {
  const { session } = useAuth()
  const access = useAccess()
  const isOwner = session?.is_owner ?? false
  const isAdmin = session?.role === 'admin' || session?.role === 'super_admin' || isOwner
  const isManager = isAdmin || session?.role === 'manager'

  const tools: Array<{ to: string; title: string; desc: string; icon: LucideIcon; show: boolean }> = [
    { to: '/shoots', title: 'Shoots', desc: 'Browse all shoots across every project.', icon: Camera, show: isManager },
    { to: '/team/work-preview', title: 'Team Work Preview', desc: 'Preview team submissions before sharing.', icon: Eye, show: access.hasModule('projects') },
    { to: '/platform/studios', title: 'Studio Access', desc: 'Platform-level studio management.', icon: Shield, show: session?.is_platform_admin ?? false },
    { to: '/platform/usage', title: 'Usage Analytics', desc: 'Platform-level usage and analytics.', icon: BarChart3, show: session?.is_platform_admin ?? false },
    { to: '/lead-sources', title: 'Facebook Import Log', desc: 'Recent leads imported from Facebook.', icon: Facebook, show: access.hasModule('settings') },
  ]
  const visible = tools.filter((t) => t.show)

  return (
    <>
      <PageHeader title="Advanced tools" description="Tools you need now and then." />
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
