import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Bell, Check, Play, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { NotificationGeneratorKey, NotificationSeverity, RunGeneratorResponse } from '@ipc/contracts'
import {
  useDismissNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useRunGenerator,
  unreadCount,
  type NotificationFilters,
} from '@/features/crm/notifications'
import { useAuth } from '@/shared/auth/AuthProvider'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'

/**
 * The 8 generators, with the plain-English description of what each one looks
 * at. Keys match the server enum; the copy is here because it is about what a
 * studio owner is choosing, not about the query.
 */
const GENERATORS: ReadonlyArray<{ key: NotificationGeneratorKey; label: string; detail: string }> = [
  { key: 'allocation_conflicts', label: 'Double bookings', detail: 'One person booked twice over the same hours.' },
  { key: 'reminders', label: 'Reminders due', detail: 'Reminders whose time has passed and are not done.' },
  { key: 'tasks', label: 'Overdue tasks', detail: 'Unfinished tasks past their due date, to their assignee.' },
  { key: 'shoots', label: 'Upcoming shoots', detail: 'Shoots in the next 7 days, to the crew booked on them.' },
  { key: 'data_pending', label: 'Data copy pending', detail: 'Shoot data whose primary copy is still pending.' },
  { key: 'backup_pending', label: 'Backup pending', detail: 'Shoot data whose backup copy is still pending.' },
  { key: 'payment_pending', label: 'Overdue invoices', detail: 'Invoices past their due date with a balance.' },
  { key: 'crm_follow_ups', label: 'Overdue follow-ups', detail: 'Leads past their promised follow-up time.' },
]

const SEVERITY_TONE: Record<NotificationSeverity, 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
}

/** Every member has alerts of their own; there is no module to gate this on. */
export function NotificationsPage({ generate }: { generate?: boolean } = {}) {
  return <Notifications generate={generate} />
}

function Notifications({ generate }: { generate?: boolean | undefined }) {
  const { session } = useAuth()
  const canGenerate = (session?.is_owner ?? false) || session?.role === 'admin' || session?.role === 'manager'

  const [filters, setFilters] = useState<NotificationFilters>({})
  // /notifications/generate used to be its own page; the link should still
  // land with the generator open rather than on the plain list.
  const [showCentre, setShowCentre] = useState(generate ?? false)
  const { data, isLoading, isError, refetch } = useNotifications(filters)
  const markRead = useMarkNotificationRead()
  const dismiss = useDismissNotification()
  const markAllRead = useMarkAllNotificationsRead()
  const unread = unreadCount(data)

  const set = (patch: Partial<NotificationFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const activeFilters = Object.values(filters).filter(Boolean).length

  return (
    <>
      <PageHeader
        title="Alerts"
        description={unread > 0 ? `${unread} unread` : 'All caught up.'}
        actions={
          <div className="flex flex-wrap gap-2">
            {canGenerate && (
              <Button size="sm" variant="outline" onClick={() => setShowCentre((v) => !v)}>
                <Zap /> {showCentre ? 'Hide' : 'Generators'}
              </Button>
            )}
            {unread > 0 && (
              <Button size="sm" variant="outline" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
                <Check /> Mark all read
              </Button>
            )}
          </div>
        }
      />

      {showCentre && canGenerate && <GeneratorCentre />}

      <Card className="mt-4">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <Label>Severity</Label>
            <Select
              value={filters.severity ?? ''}
              onChange={(e) => set({ severity: e.target.value as NotificationSeverity | '' })}
            >
              <option value="">Any</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Kind</Label>
            <Select value={filters.typePrefix ?? ''} onChange={(e) => set({ typePrefix: e.target.value })}>
              <option value="">Any</option>
              <option value="task.">Tasks</option>
              <option value="shoot.">Shoots</option>
              <option value="invoice.">Invoices</option>
              <option value="reminder.">Reminders</option>
              <option value="data.">Data</option>
              <option value="crm.">CRM</option>
              <option value="allocation.">Allocation</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <Input type="date" value={filters.dateFrom ?? ''} onChange={(e) => set({ dateFrom: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <Input type="date" value={filters.dateTo ?? ''} onChange={(e) => set({ dateTo: e.target.value })} />
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!filters.unreadOnly}
                onChange={(e) => set({ unreadOnly: e.target.checked })}
              />
              Unread only
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!filters.includeDismissed}
                onChange={(e) => set({ includeDismissed: e.target.checked })}
              />
              Show dismissed
            </label>
          </div>
          {activeFilters > 0 && (
            <div className="sm:col-span-2 lg:col-span-5">
              <Button size="sm" variant="ghost" onClick={() => setFilters({})}>
                Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonCards count={4} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            title={activeFilters > 0 ? 'Nothing matches those filters' : 'No alerts'}
            description={
              activeFilters > 0
                ? 'Try widening the date range or clearing the severity.'
                : 'Reminders and updates will appear here.'
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {data.map((n) => (
              <Card key={n.id} className={n.read_at ? 'opacity-60' : ''}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 rounded-md p-1.5 ${
                        n.severity === 'critical'
                          ? 'bg-destructive/10 text-destructive'
                          : n.read_at
                            ? 'bg-muted'
                            : 'bg-primary/10 text-primary'
                      }`}
                    >
                      {n.severity === 'critical' ? <AlertTriangle className="size-4" /> : <Bell className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{n.title}</p>
                        {n.severity !== 'info' && (
                          <StatusBadge tone={SEVERITY_TONE[n.severity]}>{n.severity}</StatusBadge>
                        )}
                        {n.dismissed_at && <StatusBadge tone="neutral">dismissed</StatusBadge>}
                      </div>
                      {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
                      {n.deep_link && <DeepLink to={n.deep_link} />}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!n.read_at && (
                      <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)} title="Mark read">
                        <Check />
                      </Button>
                    )}
                    {!n.dismissed_at && (
                      <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(n.id)} title="Dismiss">
                        <X />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/**
 * The generator test centre. Every run defaults to a dry run — the live
 * direction has to be chosen, because it emails people — and each card reports
 * what it scanned so a studio can see the rule is finding the right rows before
 * letting it write anything.
 */
function GeneratorCentre() {
  const run = useRunGenerator()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [results, setResults] = useState<Record<string, RunGeneratorResponse>>({})
  const [busy, setBusy] = useState<string | null>(null)

  function fire(key: NotificationGeneratorKey, dry: boolean) {
    setBusy(key)
    run
      .mutateAsync({
        key,
        dry_run: dry,
        date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        date_to: dateTo ? new Date(dateTo).toISOString() : undefined,
      })
      .then((res) => {
        setResults((r) => ({ ...r, [key]: res }))
        toast.success(
          dry
            ? `Dry run: ${res.scanned} would be notified`
            : `Generated ${res.generated}, ${res.deduped} already existed`,
        )
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'That generator could not run.'))
      .finally(() => setBusy(null))
  }

  async function runAllLive() {
    for (const g of GENERATORS) {
      setBusy(g.key)
      try {
        const res = await run.mutateAsync({
          key: g.key,
          dry_run: false,
          date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
          date_to: dateTo ? new Date(dateTo).toISOString() : undefined,
        })
        setResults((r) => ({ ...r, [g.key]: res }))
      } catch {
        // One failing generator must not stop the rest; its card stays blank.
      }
    }
    setBusy(null)
    toast.success('All generators ran')
  }

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <h3 className="flex items-center gap-2 font-semibold tracking-tight">
          <Zap className="size-4" /> Generate notifications
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Run a generator by hand to check what it would pick up before relying on the hourly job. Dry runs write
          nothing.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={() => void runAllLive()} disabled={!!busy}>
              <Play /> Run all live
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {GENERATORS.map((g) => {
            const res = results[g.key]
            return (
              <div key={g.key} className="rounded-lg border border-border p-3">
                <p className="font-medium">{g.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{g.detail}</p>
                {res && (
                  <p className="mt-2 text-sm">
                    {res.dry_run ? (
                      <>Would notify <strong>{res.scanned}</strong></>
                    ) : (
                      <>
                        Generated <strong>{res.generated}</strong> · {res.deduped} already existed
                      </>
                    )}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy === g.key} onClick={() => fire(g.key, true)}>
                    Dry run
                  </Button>
                  <Button size="sm" disabled={busy === g.key} onClick={() => fire(g.key, false)}>
                    Run live
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * "Open" on a notification.
 *
 * A deep link is a plain string written by whatever raised the notification --
 * a SQL generator, usually -- so it can carry a query string. TanStack Router
 * matches `to` against route paths and does not split one off, so
 * `/follow-ups?lead=abc` would look for a route literally named that and land
 * on the not-found page. Split it here, once, rather than forbidding every
 * caller from pointing at a particular record.
 */
function DeepLink({ to }: { to: string }) {
  const [path, query] = to.split('?')
  const search = query ? Object.fromEntries(new URLSearchParams(query)) : undefined
  return (
    <Link
      to={path ?? to}
      {...(search ? { search: search as never } : {})}
      className="mt-1 inline-block text-sm text-primary hover:underline"
    >
      Open
    </Link>
  )
}
