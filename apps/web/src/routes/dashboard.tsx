import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CircleAlert,
  Database,
  Eye,
  Lightbulb,
  Plus,
  Receipt,
  Target,
  Users,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { projectTrackingRow, shootListItem, type ShootListItem } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { cn } from '@/shared/ui/cn'
import {
  BAND_LABEL,
  BAND_TONE,
  NEXT_ACTION_LABEL,
  summary,
  track,
  type TrackedProject,
} from '@/features/projects/tracking'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { PageHeader } from '@/shared/layout/page-header'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { EmptyState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { useProjects } from '@/features/projects/api'
import { useClients } from '@/features/clients/api'
import { useMembers, useSlots } from '@/features/allocation/api'
import { useInvoices } from '@/features/billing/api'
import { useDataRecords } from '@/features/data/api'
import { useBoard } from '@/features/tasks/api'
import { EmployeeDashboard } from '@/features/dashboard/EmployeeDashboard'
import { buildJourney } from '@/features/onboarding/journey'
import { dashboardSections } from '@/features/onboarding/dashboard-sections'
import { SetupJourney } from '@/features/onboarding/SetupJourney'

/** Per-device: this viewer chose the whole dashboard over setup focus. */
const FULL_VIEW_KEY = 'ipc.dashboard.full'
function readFullView(): boolean {
  try {
    return globalThis.localStorage?.getItem(FULL_VIEW_KEY) === '1'
  } catch {
    return false
  }
}

export function DashboardPage() {
  return <DashboardInner />
}

const EMPLOYEE_ROLES = new Set(['employee'])

const STATUS_TONE = {
  active: 'info',
  completed: 'success',
  cancelled: 'danger',
  on_hold: 'warning',
} as const

/**
 * Lovable parity: employees get their own day view (my tasks/shoots/
 * attendance/schedule), everyone else gets the studio command center.
 *
 * The two bodies are separate components rather than two branches of one,
 * because the command center opens with nine hooks. Branching inside a single
 * component meant an employee whose session resolved after the first paint
 * rendered the owner half once and the employee half next — different hook
 * counts, and React throws.
 */
function DashboardInner() {
  const { session } = useAuth()
  if (session?.role && EMPLOYEE_ROLES.has(session.role)) {
    return (
      <>
        <PageHeader
          title={`Welcome, ${session.display_name ?? ''}`}
          description="Your tasks, shoots and attendance at a glance."
        />
        <div className="mt-4">
          <EmployeeDashboard />
        </div>
      </>
    )
  }
  return <StudioCommandCenter />
}

function StudioCommandCenter() {
  const { session } = useAuth()
  const access = useAccess()

  const projects = useProjects()
  const clients = useClients()
  const members = useMembers()
  const invoices = useInvoices()
  const slots = useSlots()
  const dataRecords = useDataRecords()
  const board = useBoard()

  // The dashboard's operational half runs off the same tracking pass the
  // Project Tracking screen uses, so the two can never disagree about which
  // job is on fire.
  const trackingRows = useQuery({
    queryKey: ['projects', 'tracking'],
    queryFn: () => callApi('/projects/tracking', { responseSchema: projectTrackingRow.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
  const shoots = useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: shootListItem.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
  const today = new Date().toISOString().slice(0, 10)
  const tracked = track(trackingRows.data ?? [], today)
  const totals = summary(tracked)

  const activeProjects = (projects.data ?? []).filter((p) => p.status === 'active').length
  const clientCount = Array.isArray(clients.data) ? clients.data.length : 0
  const teamCount = members.data?.length ?? 0
  const outstanding = (invoices.data?.items ?? []).reduce((s, i) => s + i.balance_due, 0)
  const recent = (projects.data ?? []).slice(0, 5)

  // The setup guide is for whoever is standing the studio up. An employee has
  // no business being told to add teammates or invoice a client.
  const isSetupAudience =
    session?.is_owner || session?.role === 'super_admin' || session?.role === 'admin'
  // Waiting on every query first — a half-loaded journey would show steps as
  // outstanding and then tick them off, which reads as work being undone.
  //
  // A FAILED query is not pending either, and its data is undefined, so every
  // count above collapses to zero. Without this an established studio hitting
  // a 500 is told to add its first client. Counts we could not load are not
  // counts of zero.
  const queries = [projects, clients, members, invoices, slots, dataRecords, board]
  const anyFailed = queries.some((q) => q.isError)
  const journeyReady = !queries.some((q) => q.isPending) && !anyFailed
  const journey = buildJourney(
    {
      // The owner is in the directory from registration, so they don't count.
      teammates: (members.data ?? []).filter((m) => m.user_id !== session?.user_id).length,
      clients: clientCount,
      projects: projects.data?.length ?? 0,
      bookings: (slots.data ?? []).filter((s) => s.status === 'booked').length,
      dataRecords: dataRecords.data?.length ?? 0,
      invoices: invoices.data?.items.length ?? 0,
      trackedTasks: board.data?.length ?? 0,
    },
    (m) => access.hasModule(m),
  )
  const showJourney = isSetupAudience && journeyReady && !journey.allDone

  // While a studio is still being set up, the setup journey is the whole
  // dashboard. Quick actions, tiles, "needs attention" and recent projects
  // all used to sit under it, each a door out of the one thing the page was
  // asking for — and every one of them opens onto something the journey is
  // about to walk the owner through anyway.
  //
  // It is a default, not a cage: the journey is decided by real data, so a
  // running studio that has simply never used, say, data management would
  // otherwise be kept off its own dashboard for good. "Show the full
  // dashboard" is remembered on this device.
  const [fullView, setFullView] = useState(readFullView)
  const setupFocus = showJourney && !fullView
  // Quick actions wait for the counts too, for the reason given just below.
  const settling = !!isSetupAudience && queries.some((q) => q.isPending)
  const hideBody = setupFocus || settling
  const toggleFullView = () => {
    const next = !fullView
    setFullView(next)
    try {
      globalThis.localStorage?.setItem(FULL_VIEW_KEY, next ? '1' : '0')
    } catch {
      // A blocked localStorage costs the preference, not the page.
    }
  }
  // Until the counts are real, a setup-audience viewer is shown neither the
  // journey nor the tiles — otherwise the zeros paint first and are then
  // pulled out from under them when the journey arrives.
  const countsSettled = journeyReady || !isSetupAudience
  const sections = dashboardSections(
    {
      activeProjects,
      clients: clientCount,
      teamMembers: teamCount,
      outstanding,
      recentProjects: recent.length,
    },
    showJourney || !countsSettled,
  )

  return (
    <>
      <PageHeader
        title={`Welcome, ${session?.display_name ?? ''}`}
        description={setupFocus ? "Let's get your studio ready — one step at a time." : 'Your studio at a glance.'}
        actions={
          !setupFocus &&
          access.hasAction('projects', 'create') && (
            <Button asChild>
              <Link to="/projects/new">
                <Plus /> New project
              </Link>
            </Button>
          )
        }
      />

      {showJourney && (
        <SetupJourney steps={journey.steps} completed={journey.completed} total={journey.total} />
      )}

      {showJourney && (
        <div className="-mt-4 mb-4 flex justify-end">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={toggleFullView}>
            {setupFocus ? 'Show the full dashboard' : 'Focus on setup'}
          </Button>
        </div>
      )}

      {!hideBody && (
      <>
      <QuickActions />

      {sections.stats && (
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Tile icon={Activity} value={activeProjects} label="Active projects" tone="primary" to="/projects" />
        <Tile icon={AlertTriangle} value={totals.critical} label="Critical projects" tone="danger" to="/project-tracking" />
        <Tile icon={CircleAlert} value={totals.overdue} label="Overdue tasks" hint="Across every project" tone="warning" to="/tasks" />
        <Tile icon={Database} value={totals.data_missing} label="Data missing" tone="warning" to="/data-management" />
        <Tile icon={Eye} value={totals.pending_review} label="Pending review" tone="success" to="/project-tracking" />
        {access.hasModule('billing') && (
          <Tile icon={Receipt} value={formatINR(outstanding)} label="Outstanding" tone="primary" to="/billing" />
        )}
      </div>
      )}

      {access.hasModule('projects') && sections.stats && <NeedsAttention projects={tracked} />}

      {sections.stats && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <UpcomingShoots shoots={shoots.data ?? []} />
          <Blockers projects={tracked} />
        </div>
      )}

      {access.hasModule('projects') && sections.recentProjects && (
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent projects</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">
                View all <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState
                title="No projects yet"
                description="Create your first project to start tracking shoots, tasks and payments."
                action={
                  access.hasAction('projects', 'create') && (
                    <Button asChild>
                      <Link to="/projects/new">
                        <Plus /> New project
                      </Link>
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/projects/$id"
                      params={{ id: p.id }}
                      className="flex items-center justify-between py-2.5 hover:opacity-80"
                    >
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.client_name ?? '—'}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{formatINR(p.total_cost)}</span>
                        <StatusBadge tone={STATUS_TONE[p.status]}>{humanize(p.status)}</StatusBadge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
      </>
      )}
    </>
  )
}
/**
 * The four places a studio starts its day. Links, not a menu: one press from
 * the dashboard to the thing they came to do.
 */
function QuickActions() {
  const access = useAccess()
  const actions = [
    { to: '/projects/new', label: 'Create project', icon: Plus, module: 'projects' as const },
    { to: '/team-allocation', label: 'Team booking', icon: Users, module: 'projects' as const },
    { to: '/data-management', label: 'Data management', icon: Database, module: 'projects' as const },
    { to: '/project-tracking', label: 'Project tracking', icon: Target, module: 'projects' as const },
  ].filter((a) => access.hasModule(a.module))

  if (actions.length === 0) return null

  return (
    <Card className="mt-6">
      <CardContent className="p-4">
        <p className="mb-3 text-sm font-medium">Quick actions</p>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.to} variant="outline" size="sm" asChild>
              <Link to={a.to}>
                <a.icon /> {a.label}
              </Link>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/** One counter, with its icon tile. Clickable when there is somewhere to go. */
function Tile({
  icon: Icon,
  value,
  label,
  hint,
  tone,
  to,
}: {
  icon: typeof Activity
  value: number | string
  label: string
  hint?: string
  tone: 'primary' | 'danger' | 'warning' | 'success'
  to?: string
}) {
  const body = (
    <CardContent className="flex items-start gap-3 p-4">
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          tone === 'danger'
            ? 'bg-destructive/10 text-destructive'
            : tone === 'warning'
              ? 'bg-warning/10 text-warning'
              : tone === 'success'
                ? 'bg-success/10 text-success'
                : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xl font-semibold tabular-nums leading-tight">{value}</p>
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </CardContent>
  )
  return to ? (
    <Card className="lift">
      <Link to={to} className="block">
        {body}
      </Link>
    </Card>
  ) : (
    <Card>{body}</Card>
  )
}

/**
 * What is going wrong, worst first.
 *
 * The scoring is the same pass Project Tracking uses, so a project called
 * critical here is critical there — two screens disagreeing about which job is
 * on fire is worse than neither of them saying.
 */
function NeedsAttention({ projects }: { projects: readonly TrackedProject[] }) {
  const worst = [...projects]
    .filter((p) => p.health.score > 0)
    .sort((a, b) => b.health.score - a.health.score)
    .slice(0, 3)

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle>Needs attention</CardTitle>
          <CardDescription>Highest-priority projects right now</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/project-tracking">Open project tracking</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {worst.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Nothing is behind. Every project has its next step covered.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {worst.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{p.name}</p>
                    <StatusBadge tone={BAND_TONE[p.health.band]}>
                      {BAND_LABEL[p.health.band]}
                    </StatusBadge>
                  </div>
                  <p className="text-sm text-muted-foreground">{p.client_name ?? '—'}</p>
                  {/* One symptom, not a list: the recommendation below says
                      what to do about it, and two lines of grievance push the
                      action off the card. */}
                  {worstFlag(p) && (
                    <span className="mt-1.5 inline-block rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs text-warning">
                      {worstFlag(p)}
                    </span>
                  )}
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm">
                    <Lightbulb className="size-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="font-medium text-primary">Recommended:</span>
                    <span className="text-muted-foreground">
                      {NEXT_ACTION_LABEL[p.health.next_action]}
                    </span>
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/projects/$id" params={{ id: p.id }}>
                    Open project <ArrowRight />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** The next week of shoot days, so nobody finds out on the morning. */
function UpcomingShoots({ shoots }: { shoots: readonly ShootListItem[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const soon = shoots
    .filter((s) => s.shoot_date && s.shoot_date >= today && s.shoot_date <= horizon)
    .filter((s) => s.status !== 'cancelled')
    .sort((a, b) => (a.shoot_date ?? '').localeCompare(b.shoot_date ?? ''))
    .slice(0, 5)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle>Upcoming shoots</CardTitle>
          <CardDescription>Next 7 days</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/team-allocation">Team booking</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {soon.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing booked in the next week.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {soon.map((s) => (
              <li key={s.id} className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CalendarDays className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {s.project_name ?? '—'}
                    {s.location ? ` · ${s.location}` : ''}
                  </p>
                  {s.shoot_date && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{prettyDay(s.shoot_date)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Where work is stuck: cards not backed up, and submissions waiting on a
 * review. Both are things that stall a delivery while looking like progress.
 */
function Blockers({ projects }: { projects: readonly TrackedProject[] }) {
  const stuck = projects
    .filter((p) => p.data_records_unverified > 0 || p.pending_reviews > 0)
    .sort((a, b) => b.data_records_unverified + b.pending_reviews - (a.data_records_unverified + a.pending_reviews))
    .slice(0, 5)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle>Data &amp; delivery blockers</CardTitle>
          <CardDescription>Where work is stuck</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/data-management">Data management</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {stuck.length === 0 ? (
          <p className="text-sm text-muted-foreground">No blockers right now.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {stuck.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  {p.data_records_unverified > 0 && (
                    <StatusBadge tone="warning">
                      {p.data_records_unverified} unverified
                    </StatusBadge>
                  )}
                  {p.pending_reviews > 0 && (
                    <StatusBadge tone="info">{p.pending_reviews} to review</StatusBadge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const prettyDay = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00`))

/** The single symptom worth naming on a Needs-attention row. */
function worstFlag(p: TrackedProject): string | null {
  if (p.data_records_unverified > 0) return `${p.data_records_unverified} cards not backed up`
  if (p.tasks_overdue > 0) return `${p.tasks_overdue} overdue task${p.tasks_overdue === 1 ? '' : 's'}`
  if (p.pending_reviews > 0) return `${p.pending_reviews} awaiting review`
  if (p.tasks_total === 0 && p.deliverables_total === 0) return 'No work items created yet'
  if (p.shoots_total === 0) return 'No shoot scheduled'
  return null
}
