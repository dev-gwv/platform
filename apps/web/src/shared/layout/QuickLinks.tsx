import { Link, useLocation } from '@tanstack/react-router'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from '../auth/useAccess'
import { cn } from '../ui/cn'
import { quickLinks, type QuickTone } from './nav'

/**
 * Static class strings, not a template — Tailwind reads source text, so a
 * composed `bg-tone-${tone}-soft` would compile to nothing.
 */
const TONES: Record<QuickTone, string> = {
  blue: 'bg-tone-blue-soft text-tone-blue',
  green: 'bg-tone-green-soft text-tone-green',
  violet: 'bg-tone-violet-soft text-tone-violet',
}

/**
 * The two or three screens a studio lives in, one click from anywhere.
 *
 * They already exist in the sidebar, three levels down inside collapsed
 * groups; the point of the pills is the reach, not the destination. Each wears
 * its own hue so the row is scanned by colour rather than read — which is also
 * why there are three of them and not eight.
 *
 * Hidden below `lg`: on a narrow bar the search field and the account menu are
 * worth more than a shortcut to a page the drawer already lists.
 */
export function QuickLinks({ className }: { className?: string }) {
  const { session } = useAuth()
  const access = useAccess()
  const { pathname } = useLocation()
  const links = quickLinks(session?.role ?? 'none', access, session?.is_platform_admin ?? false)

  if (links.length === 0) return null

  return (
    <nav aria-label="Shortcuts" className={cn('items-center gap-2', className)}>
      {links.map(({ to, label, icon: Icon, tone }) => {
        const active = pathname === to || pathname.startsWith(to + '/')
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            title={label}
            className={cn(
              'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-current/15 px-2 py-1.5 text-sm font-medium transition-[box-shadow,transform] active:scale-[0.98] min-[1360px]:px-3',
              'hover:ring-2 hover:ring-current/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              TONES[tone],
              active && 'ring-2 ring-current/30',
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
            {/* The bar is shared with search, due, trial and the account:
                below 1360px the pill is its icon, named on hover. */}
            <span className={Icon ? 'hidden min-[1360px]:inline' : undefined}>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
