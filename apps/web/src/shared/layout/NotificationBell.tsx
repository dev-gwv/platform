import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { Bell, CheckCheck, Loader2 } from 'lucide-react'
import type { Notification, NotificationSeverity } from '@ipc/contracts'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/features/crm/notifications'
import { badgeText, notificationTarget, timeAgo } from '@/features/crm/notification-view'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { cn } from '../ui/cn'

/** The panel shows the latest few; the rest are one tap away on Alerts. */
const LATEST = { limit: 10 }

const SEVERITY_DOT: Record<NotificationSeverity, string> = {
  info: 'bg-tone-blue',
  warning: 'bg-warning',
  critical: 'bg-destructive',
}

/**
 * Alerts, with the count on the bell and the latest ten a tap away.
 *
 * The bell used to be a link to the Alerts page, so seeing what an alert said
 * meant leaving the page you were on. Now it opens a panel: read the latest,
 * tap one to go where it points (and mark it read), or open them all.
 *
 * Ungated, like the sidebar row: reminders and overdue follow-ups land on
 * whoever owns the work, not only on the people who can open the CRM.
 *
 * A failed or still-loading count shows a plain bell — never a zero, which
 * reads as "checked, nothing there" when nothing has been checked.
 */
export function NotificationBell() {
  // Counted server-side. Counting the fetched list meant the badge stopped at
  // whatever the list was capped to, which for a badge is the whole job.
  const { data } = useUnreadCount()
  const unread = data?.unread_count ?? 0
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const panel = useRef<HTMLDivElement>(null)

  // The shell outlives navigation, so nothing else would shut the panel when
  // the page changes underneath it.
  useEffect(() => setOpen(false), [pathname])

  /** Up and down walk the alerts, from wherever focus is in the panel. */
  function onArrows(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[data-alert-row]') ?? [])]
    if (rows.length === 0) return
    e.preventDefault()
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    const down = e.key === 'ArrowDown'
    const next = at === -1 ? (down ? 0 : rows.length - 1) : (at + (down ? 1 : -1) + rows.length) % rows.length
    rows[next]?.focus()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
          className={cn(
            'relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open && 'bg-accent text-accent-foreground',
          )}
        >
          <Bell className="size-4" aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.6rem] font-semibold leading-none text-destructive-foreground"
            >
              {badgeText(unread)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={panel}
        align="end"
        aria-label="Alerts"
        // Focus the panel, not its first button: that would be "Mark all read"
        // while the list loads, one stray Enter from clearing everything.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          panel.current?.focus()
        }}
        onKeyDown={onArrows}
        className="flex w-[min(22rem,calc(100vw-2rem))] flex-col p-0"
      >
        <AlertsPanel unread={unread} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/** Mounted only while the panel is open, so the list is fetched only when looked at. */
function AlertsPanel({ unread, onClose }: { unread: number; onClose: () => void }) {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useNotifications(LATEST)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const rows = data ?? []
  // The list can know of an unread alert before the count has caught up.
  const anyUnread = unread > 0 || rows.some((n) => !n.read_at)

  function go(n: Notification) {
    // Marked read on the way out; a failed mark is toasted by the app and
    // never stops the tap from going where it points.
    if (!n.read_at) markRead.mutate(n.id)
    onClose()
    const target = notificationTarget(n)
    void navigate({ to: target.to, ...(target.search ? { search: target.search } : {}) } as never)
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <p className="text-sm font-semibold">Alerts</p>
        {unread > 0 && <p className="text-xs text-muted-foreground">{unread} unread</p>}
      </div>

      <div className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain">
        {isLoading ? (
          <p className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : isError ? (
          <div role="alert" className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <p className="text-sm">Your alerts didn’t load.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
            <Bell className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">No alerts yet</p>
            <p className="text-xs text-muted-foreground">Reminders and updates will show up here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <AlertRow key={n.id} n={n} onOpen={() => go(n)} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border p-1.5">
        <Button size="sm" variant="ghost" disabled={!anyUnread || markAll.isPending} onClick={() => markAll.mutate()}>
          <CheckCheck /> Mark all read
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/notifications" onClick={onClose}>
            See all
          </Link>
        </Button>
      </div>
    </>
  )
}

/** One alert: how serious, what, one line of detail, and when. Unread ones are bold on a tint. */
function AlertRow({ n, onOpen }: { n: Notification; onOpen: () => void }) {
  const unread = !n.read_at
  return (
    <li>
      <button
        type="button"
        data-alert-row
        onClick={onOpen}
        className={cn(
          'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted',
          'focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          unread && 'bg-primary/5',
        )}
      >
        <span
          aria-hidden
          className={cn('mt-1.5 size-2 shrink-0 rounded-full', SEVERITY_DOT[n.severity], !unread && 'opacity-40')}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-semibold' : 'text-muted-foreground')}>
              {unread && <span className="sr-only">Unread: </span>}
              {n.severity !== 'info' && <span className="sr-only">{n.severity === 'critical' ? 'Urgent: ' : 'Warning: '}</span>}
              {n.title}
            </span>
            <time dateTime={n.created_at} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {timeAgo(n.created_at)}
            </time>
          </span>
          {n.body && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.body}</span>}
        </span>
      </button>
    </li>
  )
}
