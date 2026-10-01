import { Link, useLocation } from '@tanstack/react-router'
import { Camera, Home, Inbox, MapPin, Menu, PhoneCall } from 'lucide-react'
import { seesStudioWork } from '@ipc/permissions'
import { useAccess } from '../auth/useAccess'
import { cn } from '../ui/cn'

/**
 * On a phone, the four places people go most, under the thumb. Everything
 * else stays one tap away behind Menu (the same drawer as the ☰ button).
 */
export function MobileTabBar({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation()
  const access = useAccess()
  // Staff: their day, their shoots and their attendance.
  const studio = seesStudioWork(access)
  const tabs = [
    { to: '/dashboard', label: 'Home', icon: Home, show: true },
    { to: '/follow-ups/queue', label: 'Calls', icon: PhoneCall, show: access.hasModule('crm') },
    { to: '/follow-ups', label: 'Leads', icon: Inbox, show: access.hasModule('crm') },
    { to: '/shoots', label: 'Shoots', icon: Camera, show: studio && access.hasModule('projects') },
    { to: '/shoots/my', label: 'My shoots', icon: Camera, show: !studio },
    { to: '/attendance/my', label: 'Attendance', icon: MapPin, show: !studio },
  ].filter((t) => t.show)
  const item = 'flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium'
  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      {tabs.map(({ to, label, icon: Icon }) => {
        // The longest tab that matches lights, so /shoots/my is not also Shoots.
        const hit = (t: string) => pathname === t || (t !== '/follow-ups' && pathname.startsWith(`${t}/`))
        const on = hit(to) && !tabs.some((t) => t.to.length > to.length && hit(t.to))
        return (
          <Link key={to} to={to} className={cn(item, on ? 'text-primary' : 'text-muted-foreground')} aria-current={on ? 'page' : undefined}>
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        )
      })}
      <button type="button" onClick={onMenu} className={cn(item, 'text-muted-foreground')}>
        <Menu className="size-5" aria-hidden />
        Menu
      </button>
    </nav>
  )
}
