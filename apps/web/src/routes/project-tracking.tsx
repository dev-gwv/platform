import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CalendarDays } from 'lucide-react'
import { lateOf } from '@ipc/domain'
import { projectTrackingRow } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { SkeletonCards } from '@/shared/ui/skeleton'
import {
  BAND_LABEL,
  BAND_TONE,
  NEXT_ACTION_LABEL,
  NEXT_ACTION_TAB,
  TRACKING_SORTS,
  TRACKING_TABS,
  filterAndSort,
  mostUrgent,
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

/**
 * Which project needs me today, and what do I do about it?
 *
 * The most urgent project sits on top with its one next step. Under it, every
 * project as a short card: how much of the work is done, what is late or
 * waiting, the money still due, and a button that opens the exact tab where
 * the next step is done. Tabs count projects, and the chosen tab stays in the
 * address so a link from the dashboard lands on it.
 */
function ProjectTracking() {
  const { session } = useAuth()
  const access = useAccess()
  const [tab, setTabState] = useState<TrackingTab>(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab')
    return TRACKING_TABS.some((t) => t.value === wanted) ? (wanted as TrackingTab) : 'all'
  })
  const [sort, setSort] = useState<TrackingSort>('risk')

  const setTab = (t: TrackingTab) => {
    setTabState(t)
    const url = new URL(window.location.href)
    if (t === 'all') url.searchParams.delete('tab')
    else url.searchParams.set('tab', t)
    window.history.replaceState(window.history.state, '', url)
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['projects', 'tracking'],
    queryFn: () => callApi('/projects/tracking', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })

  // One scoring pass feeds the tab counts, the top card and the list.
  const today = new Date().toISOString().slice(0, 10)
  const projects = useMemo(() => track(data ?? [], today), [data, today])
  const counts = useMemo(() => tabCounts(projects), [projects])
  const urgent = useMemo(() => mostUrgent(projects), [projects])
  const rows = useMemo(() => filterAndSort(projects, tab, sort), [projects, tab, sort])

  return (
    <>
      <Breadcrumbs items={[{ label: 'Projects', to: '/projects' }, { label: 'Project Tracking' }]} />
      <PageHeader title="Project Tracking" description="Which project needs you today — and the one thing to do next." />

      {isLoading ? (
        <SkeletonCards count={4} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : projects.length === 0 ? (
        <EmptyState title="No projects yet" description="Projects you create show up here with their progress." />
      ) : (
        <>
          {urgent && <UrgentCard project={urgent} />}

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <FilterTabs<TrackingTab> tabs={TRACKING_TABS.map((t) => ({ ...t, count: counts[t.value] }))} value={tab} onChange={setTab} />
            <Select value={sort} onChange={(e) => setSort(e.target.value as TrackingSort)} className="w-48" aria-label="Sort">
              {TRACKING_SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="mt-4">
            {rows.length === 0 ? (
              <EmptyState title="Nothing here" description="No project is in this group right now." />
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {rows.map((p) => (
                  <li key={p.id}>
                    <ProjectCard project={p} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  )
}

/** The one project to look at first, and what to do about it. */
function UrgentCard({ project: p }: { project: TrackedProject }) {
  const tab = NEXT_ACTION_TAB[p.health.next_action]
  return (
    <Card className="border-tone-rose/40 bg-tone-rose-soft/40">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <AlertTriangle className="size-6 shrink-0 text-tone-rose" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Look at this first</p>
          <p className="text-base font-semibold">{p.name}</p>
          <p className="text-sm text-muted-foreground">{NEXT_ACTION_LABEL[p.health.next_action]}</p>
        </div>
        <Button asChild>
          <Link to="/projects/$id" params={{ id: p.id }} search={tab ? { tab } : {}}>
            Do it now <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function ProjectCard({ project: p }: { project: TrackedProject }) {
  const owed = p.tasks_total + p.deliverables_total
  const done = p.tasks_done + p.deliverables_done
  const pct = Math.round(p.health.completion * 100)
  const late = lateOf(p)
  const due = Math.max(0, p.total_cost - p.received)
  const tab = NEXT_ACTION_TAB[p.health.next_action]
  const facts = [
    late > 0 && { text: `${late} late`, tone: 'text-destructive' },
    p.data_records_unverified > 0 && { text: `${p.data_records_unverified} data not backed up`, tone: 'text-destructive' },
    p.pending_reviews > 0 && { text: `${p.pending_reviews} to review`, tone: 'text-tone-amber' },
    p.deliverables_with_client > 0 && { text: `${p.deliverables_with_client} with client`, tone: 'text-muted-foreground' },
    due > 0 && p.status !== 'cancelled' && { text: `${formatINR(due)} to collect`, tone: 'text-muted-foreground' },
  ].filter(Boolean) as { text: string; tone: string }[]

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Link to="/projects/$id" params={{ id: p.id }} className="font-semibold hover:underline">
              {p.name}
            </Link>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {p.client_name ?? '—'}
              {p.next_shoot_date && (
                <span className="inline-flex items-center gap-1">
                  · <CalendarDays className="size-3" aria-hidden /> Next shoot {dayFormat.format(new Date(`${p.next_shoot_date}T00:00:00`))}
                </span>
              )}
            </p>
          </div>
          <StatusBadge tone={BAND_TONE[p.health.band]}>{BAND_LABEL[p.health.band]}</StatusBadge>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>{owed > 0 ? `Work done: ${done} of ${owed}` : 'No work added yet'}</span>
            {owed > 0 && <span className="tabular-nums">{pct}%</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', pct >= 100 ? 'bg-tone-green' : late > 0 ? 'bg-tone-amber' : 'bg-primary')}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>

        {facts.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
            {facts.map((f) => (
              <span key={f.text} className={f.tone}>
                {f.text}
              </span>
            ))}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-sm">{NEXT_ACTION_LABEL[p.health.next_action]}</span>
          {tab && (
            <Button size="sm" variant="outline" asChild>
              <Link to="/projects/$id" params={{ id: p.id }} search={{ tab }}>
                Open <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
