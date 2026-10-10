import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AutoAttendance } from '@/features/attendance/auto'
import { FollowUpReminders } from '@/features/crm/FollowUpReminders'
import { Link, useLocation } from '@tanstack/react-router'
import { BackButton } from './BackButton'
import { RefreshButton } from './RefreshButton'
import { MobileTabBar } from './MobileTabBar'
import { Menu, ChevronDown, ChevronsLeft, ChevronsRight, Search, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from '../auth/useAccess'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { NAV, type NavEntry, type NavGroup, type NavLeaf, filterNav } from './nav'
import { CommandPalette, openCommandPalette, paletteShortcutHint } from './CommandPalette'
import { QuickLinks } from './QuickLinks'
import { AssistantButton } from '@/features/assistant/AssistantButton'
import { NotificationBell } from './NotificationBell'
import { SuggestFeatureButton } from '@/features/feedback/SuggestFeature'
import { DueChip } from './DueChip'
import { NewMenu } from './NewMenu'
import { HideAmountsButton } from '@/shared/money/MoneyMask'
import { TrialChip } from '@/features/billing/TrialChip'
import { Wordmark } from '@/shared/ui/wordmark'
import { TaskOverdueBadge } from '@/features/tasks/TaskOverdueBadge'
import { AccountMenu } from './AccountMenu'
import { SetupGuideBar, useResumeSetup } from '@/features/onboarding/setup-flow'
import { SettingsFrame, settingsItemFor } from '@/features/settings/SettingsNav'
import { PlanCard } from '@/features/billing/PlanCard'
import { HelpButton } from '@/features/help/HelpPanel'
import { HelpBubble } from '@/features/help/HelpBubble'
import { HubTabs } from './HubTabs'
import { startUsageTracking, trackRouteView } from '@/shared/usage/usageTracker'
import { ConfirmEmailBanner } from '@/features/account/ConfirmEmailBanner'


const COLLAPSE_KEY = 'ipc.sidebar.collapsed'

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
  // A hub entry stands for all its pages; any of them lights it.
  const leafOf = (l: NavLeaf) => {
    for (const t of l.hub ?? []) {
      if (matches(pathname, t.to) && (best === null || t.to.length > best.length)) best = t.to
    }
    consider(l.to)
  }
  for (const e of entries) {
    if (e.kind === 'leaf') leafOf(e)
    else e.children.forEach(leafOf)
  }
  return best
}

/** The entry that is lit: the one whose own address or hub holds the active page. */
const isActive = (l: NavLeaf, active: string | null) =>
  active !== null && (l.to === active || !!l.hub?.some((t) => t.to === active))

/** The group holding the page you are on, if it sits inside one. */
function groupHolding(entries: NavEntry[], pathname: string): string | null {
  const active = activeTarget(entries, pathname)
  if (!active) return null
  for (const e of entries) {
    if (e.kind === 'group' && e.children.some((c) => isActive(c, active))) return e.label
  }
  return null
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Wordmark compact={!!compact} className="text-lg" />
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { session, signOut } = useAuth()
  useResumeSetup()
  const access = useAccess()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(
    () => globalThis.localStorage?.getItem(COLLAPSE_KEY) === '1',
  )
  const role = session?.role ?? 'none'
  const entries = filterNav(NAV, role, access, session?.is_platform_admin ?? false)

  // The menu shows headings, and opens one section at a time: the section
  // holding the page you are on, or the one you just clicked open. Every
  // group used to start open, so a new studio's first screen was a wall of
  // twenty-odd links, each one a thing it seemed to need to learn.
  //
  // What you open is remembered only until you navigate; a new page hands
  // the menu back to that page's own section. Nothing is stored, so the
  // menu can't slowly accrete open sections the way a remembered set does.
  const activeGroup = groupHolding(entries, pathname)
  const [manualGroup, setManualGroup] = useState<{ path: string; label: string | null } | null>(null)
  const openGroup = manualGroup?.path === pathname ? manualGroup.label : activeGroup

  // The shell used to unmount on every navigation, which reset this for free.
  // It mounts once now, so the drawer and its scrim would otherwise stay open
  // over the page the user just navigated to.
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // "Last seen" on the team list reads these visits. The tracker was built
  // and never started, so every member read "has not opened the app yet".
  useEffect(() => { return startUsageTracking(() => globalThis.location?.pathname ?? '/') }, [])
  const firstRoute = useRef(true)
  useEffect(() => {
    if (firstRoute.current) { firstRoute.current = false; return }
    trackRouteView(pathname)
  }, [pathname])

  useEffect(() => {
    globalThis.localStorage?.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  // Focus mode: creating a project gets the whole width, so the menu narrows
  // to its icons for that page on its own. The stored preference is left
  // alone and comes back on the next page; the toggle still works, for this
  // visit only.
  const focus = pathname.startsWith('/projects/new')
  const [peek, setPeek] = useState(false)
  useEffect(() => { setPeek(false) }, [pathname])
  const railCollapsed = focus ? !peek : collapsed

  const toggleGroup = useCallback(
    (label: string) => setManualGroup({ path: pathname, label: openGroup === label ? null : label }),
    [pathname, openGroup],
  )

  return (
    // `relative` on the shell and on <main>: every absolutely placed element
    // (an sr-only label inside a button, say) needs a positioned ancestor
    // inside the app, or it is placed against the page itself. Placed there,
    // a label far down a long list made the whole page taller than the
    // h-screen shell, and scrolling showed a band of empty background.
    <div className="relative flex h-screen overflow-hidden bg-background print:static print:block print:h-auto print:overflow-visible">
      {/* Marks attendance by itself on open, inside the person's radius (0206). */}
      <AutoAttendance />
      <FollowUpReminders />
      <Sidebar
        entries={entries}
        collapsed={railCollapsed}
        onToggleCollapse={() => (focus ? setPeek((p) => !p) : setCollapsed((c) => !c))}
        openGroup={openGroup}
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
            openGroup={openGroup}
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
          {/* Back and Refresh on every page: a way out of any screen without
              the browser's buttons, and fresh numbers without a reload. */}
          <div className="flex items-center">
            <BackButton />
            <RefreshButton />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <QuickLinks className="hidden lg:flex" />

            {/* A shortcut nobody can see is a shortcut nobody uses, so the
                trigger sits in the bar and names its own key.

                From lg the shortcut pills are up and the bar is shared with
                the due, trial and suggest chips and the account, so below 1800px
                every one of them rides in its compact form (icons, "3 due",
                "23 days left") and the field gives back its 16rem. Nothing is
                removed; at about 1250px the full forms ran the bar past the
                right edge and pushed the account menu off screen. Never put
                overflow-hidden on this bar: the account panel is not portalled. */}
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label="Search"
              className="flex shrink-0 items-center justify-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted sm:w-64 lg:w-9 lg:px-2 min-[1800px]:w-64 min-[1800px]:px-2.5"
            >
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="hidden flex-1 text-left sm:inline lg:hidden min-[1800px]:inline">Search…</span>
              <kbd className="hidden rounded border border-border px-1.5 text-[0.65rem] sm:inline min-[1800px]:inline lg:hidden">
                {paletteShortcutHint()}
              </kbd>
            </button>

            <NewMenu />
            <DueChip />
            <TrialChip />
            <SuggestFeatureButton />

            <div className="flex items-center gap-1">
              <AssistantButton />
              <NotificationBell />
              <HideAmountsButton />
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

        {/* The scroller stays put and is never transformed; only the page
            inside it animates in, keyed so each navigation replays it. */}
        <main className="relative min-w-0 flex-1 overflow-y-auto p-3 md:p-4 print:static print:overflow-visible">
          <div key={pathname} className="page-enter">
            <ConfirmEmailBanner />
            <SetupGuideBar />
            <HubTabs />
            {settingsItemFor(pathname) ? <SettingsFrame>{children}</SettingsFrame> : children}
          </div>
        </main>
        <MobileTabBar onMenu={() => setMobileOpen(true)} />
        <HelpBubble />
      </div>
    </div>
  )
}

function Sidebar({
  entries,
  collapsed,
  onToggleCollapse,
  onClose,
  openGroup,
  onToggleGroup,
  className,
}: {
  entries: NavEntry[]
  collapsed: boolean
  onToggleCollapse?: () => void
  onClose?: () => void
  openGroup: string | null
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
              active={isActive(e, active)}
              collapsed={collapsed}
              badge={e.badge}
            />
          ) : (
            <Group
              key={e.label}
              group={e}
              active={active}
              collapsed={collapsed}
              open={openGroup === e.label}
              onToggle={() => onToggleGroup(e.label)}
              onExpand={onToggleCollapse}
            />
          ),
        )}
      </nav>
      <div className={cn('shrink-0 px-3 pb-3', collapsed && 'px-2')}>
        <HelpButton collapsed={collapsed} />
        <PlanCard collapsed={collapsed} />
      </div>
      {/* On a phone the bar has room only for the bulb; the menu says it in full. */}
      {onClose && (
        <div className="border-t border-border p-3">
          <SuggestFeatureButton variant="menu" />
        </div>
      )}
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
  const hasActive = group.children.some((c) => isActive(c, active))
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
              active={isActive(c, active)}
              collapsed={false}
              badge={c.badge}
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
  badge,
}: {
  to: string
  label: string
  icon?: NavLeaf['icon']
  active: boolean
  collapsed: boolean
  badge?: NavLeaf['badge'] | undefined
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      className={cn(
        'relative flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-brand hover:text-brand-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {!collapsed && label}
      {badge === 'tasks-overdue' && <TaskOverdueBadge collapsed={collapsed} />}
    </Link>
  )
}
