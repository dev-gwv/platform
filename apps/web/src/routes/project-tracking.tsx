import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { projectTrackingRow } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { PageHeader } from '@/shared/layout/page-header'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { CountUp } from '@/shared/ui/count-up'
import { SkeletonCards, SkeletonTiles } from '@/shared/ui/skeleton'
import {
  BAND_LABEL,
  BAND_TONE,
  NEXT_ACTION_LABEL,
  TRACKING_SORTS,
  TRACKING_TABS,
  filterAndSort,
  mostUrgent,
  summary,
  tabCounts,
  track,
  type TrackedProject,
  type TrackingSort,
  type TrackingTab,
} from '@/features/projects/tracking'

const list = projectTrackingRow.array()
const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

export function ProjectTrackingPage() {
  return (
    <AuthedPage module="projects">
      <ProjectTracking />
    </AuthedPage>
  )
}

function ProjectTracking() {
  const { session } = useAuth()
  const access = useAccess()
  const [tab, setTab] = useState<TrackingTab>('all')
  const [sort, setSort] = useState<TrackingSort>('risk')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['projects', 'tracking'],
    queryFn: () => callApi('/projects/tracking', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })

  // One scoring pass feeds the tiles, the tab counts and the list, so they can
  // never disagree about what is critical.
  const today = new Date().toISOString().slice(0, 10)
  const projects = useMemo(() => track(data ?? [], today), [data, today])
  const counts = useMemo(() => tabCounts(projects), [projects])
  const totals = useMemo(() => summary(projects), [projects])
  const urgent = useMemo(() => mostUrgent(projects), [projects])
  const rows = useMemo(() => filterAndSort(projects, tab, sort), [projects, tab, sort])

  return (
    <>
      <Breadcrumbs items={[{ label: 'Projects', to: '/projects' }, { label: 'Project Tracking' }]} />
      <PageHeader
        title="Project Tracking"
        description="Project health at a glance — completion, blockers, overdue work, missing data, pending review, and the recommended next action."
      />

      {isLoading ? (
        <div className="flex flex-col gap-4">
          <SkeletonTiles count={6} />
          <SkeletonCards count={4} />
        </div>
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
            <UrgentCard project={urgent} className="sm:col-span-2 lg:col-span-3 xl:col-span-2" />
            <Tile icon={AlertTriangle} label="Critical" value={totals.critical} tone="danger" />
            <Tile icon={Target} label="Low progress" value={totals.low_progress} tone="warning" />
            <Tile icon={Database} label="Data missing" value={totals.data_missing} tone="danger" />
            <Tile icon={Activity} label="Overdue work" value={totals.overdue} tone="warning" />
            <Tile icon={Eye} label="Pending review" value={totals.pending_review} tone="info" />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <FilterTabs<TrackingTab>
              tabs={TRACKING_TABS.map((t) => ({ ...t, count: counts[t.value] }))}
              value={tab}
              onChange={setTab}
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Sort
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value as TrackingSort)}
                className="w-56"
                aria-label="Sort projects"
              >
                {TRACKING_SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="mt-4">
            {rows.length === 0 ? (
              <Card>
                <CardContent className="py-4">
                  <EmptyState
                    title={
                      projects.length === 0
                        ? 'No projects to track yet.'
                        : 'Nothing in this bucket.'
                    }
                    description={
                      projects.length === 0
                        ? 'Create a project and its health appears here as work is planned against it.'
                        : 'Every project is clear of this one. Try another tab.'
                    }
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-3">
                {rows.map((p) => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </div>
            )}
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Completion = completed tasks + deliverables ÷ total. Data status uses shoot-linked items
            only.
          </p>
        </>
      )}
    </>
  )
}

const TONE_CLASS = {
  danger: 'bg-destructive/10 text-destructive',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-primary/10 text-primary',
} as const

function Tile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: number
  tone: keyof typeof TONE_CLASS
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', TONE_CLASS[tone])}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-semibold tabular-nums">
            <CountUp value={value} />
          </p>
          <p className="text-xs leading-tight text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The one project to open first. On a quiet board it says so rather than
 * nominating whichever project happened to sort first.
 */
function UrgentCard({ project, className }: { project: TrackedProject | null; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <AlertTriangle className={cn('size-3.5', project ? 'text-destructive' : 'text-muted-foreground')} />
          Most urgent project
        </p>
        {project ? (
          <>
            <Link
              to="/projects/$id"
              params={{ id: project.id }}
              className="mt-1 block truncate font-semibold hover:underline"
            >
              {project.name}
            </Link>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {NEXT_ACTION_LABEL[project.health.next_action]}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No urgent projects right now.</p>
        )}
      </CardContent>
    </Card>
  )
}

function ProjectRow({ project: p }: { project: TrackedProject }) {
  const [open, setOpen] = useState(false)
  const pct = Math.round(p.health.completion * 100)
  const chips: string[] = []
  if (p.tasks_overdue) chips.push(`${p.tasks_overdue} overdue`)
  if (p.data_records_unverified) chips.push(`${p.data_records_unverified} unverified`)
  if (p.pending_reviews) chips.push(`${p.pending_reviews} to review`)

  return (
    <Card className="lift">
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/projects/$id"
              params={{ id: p.id }}
              className="truncate font-medium hover:underline"
            >
              {p.name}
            </Link>
            <StatusBadge tone={BAND_TONE[p.health.band]}>{BAND_LABEL[p.health.band]}</StatusBadge>
            {chips.map((c) => (
              <StatusBadge key={c} tone="neutral">
                {c}
              </StatusBadge>
            ))}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {p.client_name ?? 'No client'} · {formatINR(p.total_cost)}
            {p.shoots_total > 0 && (
              <>
                {' · '}
                {p.shoots_done}/{p.shoots_total} shoots done
              </>
            )}
            {p.next_shoot_date && (
              <>
                {' · '}
                <CalendarDays className="inline size-3.5 align-[-2px]" /> next shoot{' '}
                {dayFormat.format(new Date(`${p.next_shoot_date}T00:00:00`))}
              </>
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Last activity {dayFormat.format(new Date(p.last_activity_at))}
          </p>
        </div>

        <div className="w-44">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Completion</span>
            <span className="font-medium tabular-nums">{pct}%</span>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${p.name} completion`}
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500',
                p.health.band === 'critical' ? 'bg-destructive' : 'bg-primary',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {p.tasks_done + p.deliverables_done} of {p.tasks_total + p.deliverables_total} items
          </p>
        </div>

        {/* The same five figures the health breakdown spells out below, kept on
            the row so a studio can scan twenty projects for the one that is
            short a copy or a review without expanding each of them. */}
        <div className="hidden shrink-0 gap-4 lg:flex">
          <Figure label="Tasks" value={`${p.tasks_done}/${p.tasks_total}`} />
          <Figure label="Deliverables" value={`${p.deliverables_done}/${p.deliverables_total}`} />
          <Figure
            label="Data"
            value={
              p.data_records_total === 0
                ? '—'
                : p.data_records_unverified > 0
                  ? String(p.data_records_unverified)
                  : 'OK'
            }
            tone={p.data_records_unverified > 0 ? 'danger' : undefined}
          />
          <Figure
            label="Overdue"
            value={String(p.tasks_overdue)}
            tone={p.tasks_overdue > 0 ? 'danger' : undefined}
          />
          <Figure label="Review" value={String(p.pending_reviews)} />
        </div>

        <div className="flex min-w-56 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <Link
            to="/projects/$id"
            params={{ id: p.id }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">Next action</span>
              <span className="block truncate font-medium">
                {NEXT_ACTION_LABEL[p.health.next_action]}
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Details
          </button>
        </div>
      </CardContent>
      {open && <DetailsPanel project={p} />}
    </Card>
  )
}

/** One figure in the row's at-a-glance strip: a caption over a number. */
function Figure({ label, value, tone }: { label: string; value: string; tone?: 'danger' | undefined }) {
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-sm font-medium tabular-nums', tone === 'danger' && 'text-destructive')}>
        {value}
      </p>
    </div>
  )
}

/** Expandable health breakdown: team load, data, delivery and money. */
function DetailsPanel({ project: p }: { project: TrackedProject }) {
  const teamDone = p.tasks_done
  const teamTotal = p.tasks_total
  return (
    <div className="border-t border-border bg-muted/20 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Health breakdown
      </p>
      <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
        <HealthRow
          icon={Users}
          label="Team"
          value={
            teamTotal === 0
              ? 'No tasks yet'
              : p.tasks_overdue > 0
                ? `${p.tasks_overdue} overdue · ${teamDone}/${teamTotal} done`
                : `On track (${teamDone}/${teamTotal} done)`
          }
          tone={teamTotal === 0 ? 'neutral' : p.tasks_overdue > 0 ? 'danger' : 'success'}
          projectId={p.id}
        />
        <HealthRow
          icon={Database}
          label="Data"
          value={
            p.data_records_total === 0
              ? 'No data records'
              : p.data_records_unverified > 0
                ? `${p.data_records_unverified} of ${p.data_records_total} unverified`
                : `Verified (${p.data_records_total})`
          }
          tone={p.data_records_unverified > 0 ? 'warning' : 'success'}
          projectId={p.id}
        />
        <HealthRow
          icon={Eye}
          label="Delivery"
          value={
            p.deliverables_total === 0
              ? 'No deliverables'
              : p.pending_reviews > 0
                ? `${p.deliverables_done}/${p.deliverables_total} done · ${p.pending_reviews} to review`
                : `${p.deliverables_done}/${p.deliverables_total} done`
          }
          tone={p.pending_reviews > 0 ? 'info' : 'neutral'}
          projectId={p.id}
        />
        <HealthRow
          icon={Wallet}
          label="Payments"
          value={`${formatINR(p.total_cost)} project value`}
          tone="neutral"
          projectId={p.id}
        />
      </div>
    </div>
  )
}

function HealthRow({
  icon: Icon,
  label,
  value,
  tone,
  projectId,
}: {
  icon: LucideIcon
  label: string
  value: string
  tone: 'danger' | 'warning' | 'success' | 'info' | 'neutral'
  projectId: string
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'success'
          ? 'text-success'
          : tone === 'info'
            ? 'text-primary'
            : 'text-muted-foreground'
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-xs">
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={cn('truncate font-medium', toneClass)}>{value}</span>
      </span>
      <Link to="/projects/$id" params={{ id: projectId }} className="shrink-0 font-medium text-primary hover:underline">
        Open
      </Link>
    </div>
  )
}
