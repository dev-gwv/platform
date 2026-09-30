import { Link, useLocation } from '@tanstack/react-router'
import { useAccess } from '../auth/useAccess'
import { cn } from '../ui/cn'
import { hubFor } from './hubs'

/**
 * The tab row on top of a hub's pages (People, Attendance & leave, Pay).
 * Links, not state: each tab is its own page and address. Hidden when this
 * person can open only one of them.
 */
export function HubTabs() {
  const { pathname } = useLocation()
  const access = useAccess()
  const hub = hubFor(pathname)
  if (!hub) return null
  const tabs = hub.filter((t) => access.hasModule(t.module))
  if (tabs.length < 2) return null
  const here = pathname.replace(/\/+$/, '')

  return (
    <nav
      aria-label="Pages in this section"
      className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-card p-1"
    >
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          aria-current={here === t.to ? 'page' : undefined}
          className={cn(
            'whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            here === t.to
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
