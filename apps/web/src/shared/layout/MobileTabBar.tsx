import { Link, useLocation } from '@tanstack/react-router'
import { Camera, ClipboardList, Home, Inbox, MapPin, Menu, PhoneCall } from 'lucide-react'
import { seesStudioWork } from '@ipc/permissions'
import { useAccess } from '../auth/useAccess'
import { cn } from '../ui/cn'
import { useAttendanceMe } from '@/features/attendance/api'

/**
 * On a phone, the four places people go most, under the thumb. Everything
 * else stays one tap away behind Menu (the same drawer as the ☰ button).
 */
export function MobileTabBar({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation()
  const access = useAccess()
  // Staff: their day, their work, their shoots and their attendance.
  const studio = seesStudioWork(access)
  // Attendance earns a tab only while the studio has it switched on (0224).
  const attendanceOn = useAttendanceMe().data?.enabled ?? false
  // In the order they matter; at most four, so with Menu the bar is never more than five.
  const tabs = [
    { to: '/dashboard', label: 'Home', icon: Home, show: true },
    // An editor's day is their edits: My work sits under the thumb too.
    { to: '/my-work', label: 'My work', icon: ClipboardList, show: !studio },
    { to: '/shoots/my', label: 'My shoots', icon: Camera, show: !studio },
    { to: '/follow-ups/queue', label: 'Calls', icon: PhoneCall, show: access.hasModule('crm') },
    { to: '/attendance/my', label: 'Attendance', icon: MapPin, show: !studio && attendanceOn },
    { to: '/follow-ups', label: 'Leads', icon: Inbox, show: access.hasModule('crm') },
    { to: '/shoots', label: 'Shoots', icon: Camera, show: studio && access.hasModule('projects') },
  ]
    .filter((t) => t.show)
    .slice(0, 4)
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
