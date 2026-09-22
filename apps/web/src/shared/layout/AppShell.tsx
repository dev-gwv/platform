import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Menu, Moon, Sun, ChevronDown, ChevronsLeft, ChevronsRight, Search, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from '../auth/useAccess'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { NAV, type NavEntry, type NavGroup, type NavLeaf, filterNav } from './nav'
import { CommandPalette, openCommandPalette, paletteShortcutHint } from './CommandPalette'
import { QuickLinks } from './QuickLinks'
import { NotificationBell } from './NotificationBell'
import { AccountMenu } from './AccountMenu'


const COLLAPSE_KEY = 'ipc.sidebar.collapsed'
const GROUPS_KEY = 'ipc.sidebar.groups'

/**
 * Which nav groups are open, remembered across mounts.
 *
 * Every route wraps itself in AuthedPage → AppShell, so the whole sidebar
 * unmounts and rebuilds on each navigation. Local state would reset to the
 * default on every click — collapse a group, open something inside it, and it
 * springs back open. Storage outlives the remount; so does the scroll position
 * below, for the same reason.
 */
function readOpenGroups(): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(GROUPS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/** How far the nav was scrolled, so a remount doesn't jump back to the top. */
let navScrollTop = 0

const matches = (pathname: string, to: string) =>
  pathname === to || pathname.startsWith(to + '/')

/**
 * Only the deepest match lights up: on /projects/new both "All Projects"
 * (/projects) and "Create Project" prefix-match, and two lit rows read as a
 * bug.
 */
function activeTarget(entries: NavEntry[], pathname: string): string | null {
  let best: string | null = null
  const consider = (to: string) => {
    if (matches(pathname, to) && (best === null || to.length > best.length)) best = to
  }
  for (const e of entries) {
    if (e.kind === 'leaf') consider(e.to)
    else for (const c of e.children) consider(c.to)
  }
  return best
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <span className="whitespace-nowrap text-base font-bold tracking-tight">
      <span className="text-brand">IPC</span>
      {!compact && ' Studios'}
    </span>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { session, signOut } = useAuth()
  const access = useAccess()
  const { scheme, toggleScheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(
    () => globalThis.localStorage?.getItem(COLLAPSE_KEY) === '1',
  )
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(readOpenGroups)
  const role = session?.role ?? 'none'
  const entries = filterNav(NAV, role, access, session?.is_platform_admin ?? false)

  // The shell used to unmount on every navigation, which reset this for free.
  // It mounts once now, so the drawer and its scrim would otherwise stay open
  // over the page the user just navigated to.
  useEffect(() => setMobileOpen(false), [pathname])

  useEffect(() => {
    globalThis.localStorage?.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const toggleGroup = useCallback((label: string) => {
    setOpenGroups((groups) => {
      const next = { ...groups, [label]: !(groups[label] ?? true) }
      try {
        globalThis.localStorage?.setItem(GROUPS_KEY, JSON.stringify(next))
      } catch {
        // A blocked localStorage costs the preference, not the navigation.
      }
      return next
    })
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
      <Sidebar
        entries={entries}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        openGroups={openGroups}
        onToggleGroup={toggleGroup}
        className="hidden md:flex"
      />

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />
          <Sidebar
            entries={entries}
            collapsed={false}
            onClose={() => setMobileOpen(false)}
            openGroups={openGroups}
            onToggleGroup={toggleGroup}
            className="fixed inset-y-0 left-0 z-50 flex md:hidden"
          />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <span className="md:hidden">
            <Brand />
          </span>

          <div className="ml-auto flex items-center gap-2">
            <QuickLinks className="hidden lg:flex" />

            {/* A shortcut nobody can see is a shortcut nobody uses, so the
                trigger sits in the bar and names its own key.

                Between lg and xl the pills are up and the bar is full, so the
                field gives back its 16rem and rides as an icon until the
                label fits again. */}
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label="Search"
              className="flex items-center justify-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted sm:w-64 lg:w-9 lg:px-2 xl:w-64 xl:px-2.5"
            >
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="hidden flex-1 text-left sm:inline lg:hidden xl:inline">Search…</span>
              <kbd className="hidden rounded border border-border px-1.5 text-[0.65rem] sm:inline xl:inline lg:hidden">
                {paletteShortcutHint()}
              </kbd>
            </button>

            <div className="flex items-center gap-1">
              <NotificationBell />
              <Button variant="ghost" size="icon" onClick={toggleScheme} aria-label="Toggle theme">
                {scheme === 'dark' ? <Sun /> : <Moon />}
              </Button>
              <AccountMenu onSignOut={() => void signOut()} />
            </div>
          </div>
        </header>

        {session?.plan_gate === 'grace' && (
          <div className="shrink-0 bg-warning/15 px-4 py-2 text-center text-sm text-warning">
            Your plan is in its grace period. Renew soon to avoid interruption.
          </div>
        )}

        <CommandPalette />

        <main
          key={pathname}
          className="page-enter min-w-0 flex-1 overflow-y-auto p-3 md:p-4 print:overflow-visible"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

function Sidebar({
  entries,
  collapsed,
  onToggleCollapse,
  onClose,
  openGroups,
  onToggleGroup,
  className,
}: {
  entries: NavEntry[]
  collapsed: boolean
  onToggleCollapse?: () => void
  onClose?: () => void
  openGroups: Record<string, boolean>
  onToggleGroup: (label: string) => void
  className?: string
}) {
  const { pathname } = useLocation()
  const active = activeTarget(entries, pathname)
  const navRef = useRef<HTMLElement>(null)

  // Restore the scroll offset this sidebar had before the route change tore it
  // down, so clicking a link near the bottom doesn't fling the menu to the top.
  useEffect(() => {
    if (navRef.current) navRef.current.scrollTop = navScrollTop
  }, [])
  return (
    <aside
      className={cn(
        'shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        collapsed ? 'w-[4.5rem]' : 'w-64',
        className,
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center border-b border-border px-4', collapsed && 'px-0')}>
        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="mx-auto flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ChevronsRight className="size-5" />
          </button>
        ) : (
          <>
            <Brand />
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <ChevronsLeft className="size-5" />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            )}
          </>
        )}
      </div>

      {!collapsed && (
        <p className="px-4 pb-1 pt-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Menu
        </p>
      )}

      <nav
        ref={navRef}
        onScroll={(e) => {
          navScrollTop = e.currentTarget.scrollTop
        }}
        className={cn('flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-2', collapsed && 'px-2 pt-2')}
      >
        {entries.map((e) =>
          e.kind === 'leaf' ? (
            <NavItem
              key={e.to}
              to={e.to}
              label={e.label}
              icon={e.icon}
              active={e.to === active}
              collapsed={collapsed}
            />
          ) : (
            <Group
              key={e.label}
              group={e}
              active={active}
              collapsed={collapsed}
              open={openGroups[e.label] ?? true}
              onToggle={() => onToggleGroup(e.label)}
              onExpand={onToggleCollapse}
            />
          ),
        )}
      </nav>
    </aside>
  )
}

function Group({
  group,
  active,
  collapsed,
  open,
  onToggle,
  onExpand,
}: {
  group: NavGroup
  active: string | null
  collapsed: boolean
  open: boolean
  onToggle: () => void
  onExpand?: (() => void) | undefined
}) {
  const hasActive = group.children.some((c) => c.to === active)
  const Icon = group.icon

  // Collapsed: the group icon is a stub — clicking it reopens the rail with the
  // group expanded, so no child route is stranded behind the collapse.
  return (
    <div className={cn(!collapsed && 'mt-0.5')}>
      <button
        type="button"
        onClick={() => {
          if (collapsed) {
            if (!open) onToggle()
            onExpand?.()
          } else {
            onToggle()
          }
        }}
        title={collapsed ? group.label : undefined}
        className={cn(
          'flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-brand hover:text-brand-foreground',
          hasActive ? 'text-foreground' : 'text-muted-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        {Icon && <Icon className="size-4 shrink-0" />}
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{group.label}</span>
            <ChevronDown className={cn('size-4 transition-transform', open ? '' : '-rotate-90')} />
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="ml-[1.4rem] space-y-0.5 border-l border-border pl-3">
          {group.children.map((c) => (
            <NavItem
              key={c.to}
              to={c.to}
              label={c.label}
              icon={c.icon}
              active={c.to === active}
              collapsed={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NavItem({
  to,
  label,
  icon: Icon,
  active,
  collapsed,
}: {
  to: string
  label: string
  icon?: NavLeaf['icon']
  active: boolean
  collapsed: boolean
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-brand hover:text-brand-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {!collapsed && label}
    </Link>
  )
}
