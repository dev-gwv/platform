import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CalendarDays, ChevronDown, Download, Search } from 'lucide-react'
import { lateOf, type ReasonCode } from '@ipc/domain'
import { projectTrackingRow, trackingBreakdown } from '@ipc/contracts'
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
import { Input, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { MetricCard } from '@/shared/ui/metric-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import {
  BAND_LABEL,
  BAND_TONE,
  NEXT_ACTION_LABEL,
  NEXT_ACTION_TAB,
  REASON_TONE,
  TRACKING_SORTS,
  TRACKING_TABS,
  filterAndSort,
  matchesSearch,
  mostUrgent,
  reasonLabel,
  summary,
  tabCounts,
  track,
  type TrackedProject,
  type TrackingSort,
  type TrackingTab,
} from '@/features/projects/tracking'

const list = projectTrackingRow.array()
const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const day = (d: string | null) => (d ? dayFormat.format(new Date(`${d}T00:00:00`)) : '—')
/** Today where the studio is (India), as YYYY-MM-DD. */
const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)

export function ProjectTrackingPage() {
  return (
    <AuthedPage module="projects">
      <ProjectTracking />
    </AuthedPage>
  )
}

/** Tab, sort and search live in the address, so a link or a refresh lands in the same place. */
function useUrlState<T extends string>(key: string, fallback: T, valid: (v: string) => boolean) {
  const [value, setValue] = useState<T>(() => {
    const v = new URLSearchParams(window.location.search).get(key)
    return v !== null && valid(v) ? (v as T) : fallback
  })
  const set = (v: T) => {
    setValue(v)
    const url = new URL(window.location.href)
    if (v === fallback) url.searchParams.delete(key)
    else url.searchParams.set(key, v)
    window.history.replaceState(window.history.state, '', url)
  }
  return [value, set] as const
}

/**
 * Which project needs me today, why, and what do I do about it?
 *
 * The health of every project is worked out once, on the server, by the same
 * rules the dashboard uses: its reasons in one fixed order (footage, late
 * work, work to review, crew, money, planning) and the first reason's action.
 * Open a project to see exactly what is late and on whom.
 */
function ProjectTracking() {
  const { session } = useAuth()
  const access = useAccess()
  const [tab, setTab] = useUrlState<TrackingTab>('tab', 'all', (v) => TRACKING_TABS.some((t) => t.value === v))
  const [sort, setSort] = useUrlState<TrackingSort>('sort', 'risk', (v) => TRACKING_SORTS.some((t) => t.value === v))
  const [q, setQ] = useUrlState<string>('q', '', () => true)
  const [open, setOpen] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['projects', 'tracking'],
    queryFn: () => callApi('/projects/tracking', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })

  const projects = useMemo(() => track(data ?? [], todayIST()), [data])
  const searched = useMemo(() => projects.filter((p) => matchesSearch(p, q)), [projects, q])
  const counts = useMemo(() => tabCounts(searched), [searched])
  const figures = useMemo(() => summary(projects), [projects])
  const urgent = useMemo(() => mostUrgent(projects), [projects])
  const rows = useMemo(() => filterAndSort(searched, tab, sort), [searched, tab, sort])
  const seesMoney = projects.some((p) => p.total_cost !== null)

  function exportCsv() {
    downloadCsv(
      `project-tracking-${todayIST()}.csv`,
      toCsv(
        [
          'Project', 'Client', 'Health', 'Why', 'Next step', 'Work done %', 'Late', 'Data not safe', 'To review', 'Shoots short of crew',
          'Next shoot', 'Next delivery due', ...(seesMoney ? ['Package', 'Received', 'Overdue on invoices'] : []),
        ],
        rows.map((p) => [
          p.name,
          p.client_name,
          BAND_LABEL[p.health.band],
          p.health.reasons.map((r) => reasonLabel(r.code, r.count)).join('; '),
          NEXT_ACTION_LABEL[p.health.next_action],
          Math.round(p.health.completion * 100),
          lateOf(p),
          p.data_records_unverified + p.data_missing + p.data_issues,
          p.pending_reviews,
          p.shoots_short,
          p.next_shoot_date,
          p.next_due_date,
          ...(seesMoney ? [p.total_cost, p.received, p.overdue_amount] : []),
        ]),
      ),
    )
  }

  return (
    <>
      <Breadcrumbs items={[{ label: 'Projects', to: '/projects' }, { label: 'Project Tracking' }]} />
      <PageHeader title="Project Tracking" description="Which project needs you today, why, and the one thing to do next." />

      {isLoading ? (
        <SkeletonCards count={4} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : projects.length === 0 ? (
        <EmptyState title="No projects yet" description="Projects you create show up here with their progress." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure onClick={() => setTab('attention')}>
              <MetricCard label="Needs attention" value={figures.attention} tone={figures.attention ? 'danger' : 'success'} hint="projects to act on" />
            </Figure>
            <Figure onClick={() => setTab('overdue')}>
              <MetricCard label="Late work" value={figures.overdue} tone={figures.overdue ? 'danger' : 'success'} hint="projects past a due date" />
            </Figure>
            <Figure onClick={() => setTab('data_missing')}>
              <MetricCard label="Data not safe" value={figures.data_missing} tone={figures.data_missing ? 'warning' : 'success'} hint="projects with footage at risk" />
            </Figure>
            <Figure onClick={() => setTab('pending_review')}>
              <MetricCard label="To review" value={figures.pending_review} tone={figures.pending_review ? 'warning' : 'muted'} hint="projects with work handed in" />
            </Figure>
          </div>

          {urgent && <UrgentCard project={urgent} />}

          <div className="mt-4 flex flex-col gap-3">
            <FilterTabs<TrackingTab> tabs={TRACKING_TABS.map((t) => ({ ...t, count: counts[t.value] }))} value={tab} onChange={setTab} />
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[14rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input aria-label="Search projects" placeholder="Project or client…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
              </div>
              <Select value={sort} onChange={(e) => setSort(e.target.value as TrackingSort)} className="w-48" aria-label="Sort">
                {TRACKING_SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
                <Download /> CSV
              </Button>
            </div>
          </div>

          <div className="mt-4">
            {rows.length === 0 ? (
              <EmptyState title="Nothing here" description={q ? 'No project matches that search.' : 'No project is in this group right now.'} />
            ) : (
              <ul className="flex flex-col gap-3">
                {rows.map((p) => (
                  <li key={p.id}>
                    <ProjectRow project={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
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

function Figure({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </button>
  )
}

/** The one project to look at first, and what to do about it. */
function UrgentCard({ project: p }: { project: TrackedProject }) {
  const tab = NEXT_ACTION_TAB[p.health.next_action]
  const why = p.health.reasons[0]
  return (
    <Card className="mt-4 border-tone-rose/40 bg-tone-rose-soft/40">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <AlertTriangle className="size-6 shrink-0 text-tone-rose" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Look at this first</p>
          <p className="text-base font-semibold">{p.name}</p>
          <p className="text-sm text-muted-foreground">
            {NEXT_ACTION_LABEL[p.health.next_action]}
            {why ? ` · ${reasonLabel(why.code, why.count)}` : ''}
          </p>
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

function ProjectRow({ project: p, open, onToggle }: { project: TrackedProject; open: boolean; onToggle: () => void }) {
  const owed = p.tasks_total + p.deliverables_total
  const done = p.tasks_done + p.deliverables_done
  const pct = Math.round(p.health.completion * 100)
  const late = lateOf(p)
  const tab = NEXT_ACTION_TAB[p.health.next_action]
  const due = p.total_cost !== null && p.received !== null ? Math.max(0, p.total_cost - p.received) : null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-[12rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/projects/$id" params={{ id: p.id }} className="font-semibold hover:underline">
                {p.name}
              </Link>
              <StatusBadge tone={BAND_TONE[p.health.band]}>{BAND_LABEL[p.health.band]}</StatusBadge>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {p.client_name ?? '—'}
              {p.next_shoot_date && (
                <span className="inline-flex items-center gap-1">
                  · <CalendarDays className="size-3" aria-hidden /> Next shoot {day(p.next_shoot_date)}
                </span>
              )}
              {p.next_due_date && <span>· Next delivery due {day(p.next_due_date)}</span>}
              {due !== null && due > 0 && <span>· {formatINR(due)} to collect</span>}
            </p>
          </div>
          <div className="w-44 shrink-0">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{owed > 0 ? `${done} of ${owed} done` : 'No work added'}</span>
              {owed > 0 && <span className="tabular-nums">{pct}%</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', pct >= 100 ? 'bg-tone-green' : late > 0 ? 'bg-tone-amber' : 'bg-primary')}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>
        </div>

        {p.health.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {p.health.reasons.map((r) => (
              <StatusBadge key={r.code} tone={REASON_TONE[r.code as ReasonCode]}>
                {reasonLabel(r.code as ReasonCode, r.count)}
              </StatusBadge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-sm font-medium">{NEXT_ACTION_LABEL[p.health.next_action]}</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={onToggle} aria-expanded={open}>
              <ChevronDown className={cn('transition-transform', open && 'rotate-180')} /> {open ? 'Hide' : 'Details'}
            </Button>
            {tab && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/projects/$id" params={{ id: p.id }} search={{ tab }}>
                  Open <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
        </div>
        {open && <Breakdown project={p} />}
      </CardContent>
    </Card>
  )
}

/** One project opened up: what is late or waiting, and on whom. */
function Breakdown({ project: p }: { project: TrackedProject }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['projects', 'tracking', p.id],
    queryFn: () => callApi(`/projects/tracking/${p.id}`, { responseSchema: trackingBreakdown }),
    staleTime: 30_000,
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (isError || !data) return <p className="text-sm text-destructive">We could not load this project.</p>

  const late = data.deliverables.filter((d) => d.days_late > 0)
  const open = data.deliverables.filter((d) => d.days_late === 0)
  return (
    <div className="grid gap-3 rounded-xl bg-muted/40 p-3 md:grid-cols-2">
      {p.health.reasons.length > 0 && (
        <Block title="What to do, in order" className="md:col-span-2">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {p.health.reasons.map((r) => (
              <li key={r.code}>
                {NEXT_ACTION_LABEL[r.action as keyof typeof NEXT_ACTION_LABEL] ?? r.action}{' '}
                <span className="text-muted-foreground">— {reasonLabel(r.code as ReasonCode, r.count)}</span>
              </li>
            ))}
          </ol>
        </Block>
      )}
      <Block title={`Late (${late.length + data.tasks.length})`}>
        {late.length + data.tasks.length === 0 ? (
          <Nothing>Nothing late.</Nothing>
        ) : (
          <ul className="space-y-1 text-sm">
            {late.map((d) => (
              <Item key={d.id} title={d.title} who={d.assignee_name} extra={`${d.stage} · due ${day(d.estimated_date)} · ${d.days_late}d late`} bad />
            ))}
            {data.tasks.map((t) => (
              <Item key={t.id} title={t.title} who={t.assignee_names.join(', ') || null} extra={`Task · due ${day(t.due_date)} · ${t.days_late}d late`} bad />
            ))}
          </ul>
        )}
      </Block>
      <Block title={`Still to deliver (${open.length})`}>
        {open.length === 0 ? (
          <Nothing>Nothing else open.</Nothing>
        ) : (
          <ul className="space-y-1 text-sm">
            {open.slice(0, 8).map((d) => (
              <Item key={d.id} title={d.title} who={d.assignee_name} extra={`${d.stage}${d.estimated_date ? ` · due ${day(d.estimated_date)}` : ''}`} />
            ))}
            {open.length > 8 && <li className="text-xs text-muted-foreground">+{open.length - 8} more</li>}
          </ul>
        )}
      </Block>
      <Block title={`Waiting for your review (${data.submissions.length})`}>
        {data.submissions.length === 0 ? (
          <Nothing>Nothing handed in.</Nothing>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.submissions.map((s) => (
              <Item key={s.id} title={s.title ?? 'Submission'} who={s.submitted_by_name} extra={`handed in ${new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`} />
            ))}
          </ul>
        )}
      </Block>
      <Block title={`Shoots (${data.shoots.length})`}>
        {data.shoots.length === 0 ? (
          <Nothing>No shoot yet.</Nothing>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.shoots.map((s) => {
              const short = s.needed > s.booked && (!s.shoot_date || s.shoot_date >= todayIST())
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{day(s.shoot_date)}</span>
                  <span className={cn('text-xs', short ? 'text-tone-amber' : 'text-muted-foreground')}>
                    crew {s.booked}
                    {s.needed ? `/${s.needed}` : ''}
                  </span>
                  {s.data_missing > 0 && <span className="text-xs text-destructive">{s.data_missing} data not handed over</span>}
                  {s.data_unsafe > 0 && <span className="text-xs text-tone-amber">{s.data_unsafe} data not safe</span>}
                </li>
              )
            })}
          </ul>
        )}
      </Block>
      {data.money && (
        <Block title="Money" className="md:col-span-2">
          <p className="text-sm">
            Package {formatINR(data.money.total_cost)} · received {formatINR(data.money.received)} ·{' '}
            <b>{formatINR(data.money.balance)} to collect</b>
          </p>
          {data.money.invoices_overdue.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-sm text-destructive">
              {data.money.invoices_overdue.map((i) => (
                <li key={i.id}>
                  Invoice {i.invoice_number ?? ''} · {formatINR(i.balance_due)} overdue since {day(i.due_date)}
                </li>
              ))}
            </ul>
          )}
        </Block>
      )}
    </div>
  )
}

function Block({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-3', className)}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

const Nothing = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>

function Item({ title, who, extra, bad }: { title: string; who: string | null; extra: string; bad?: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{who ?? 'Unassigned'}</span>
      <span className={cn('text-xs', bad ? 'text-destructive' : 'text-muted-foreground')}>{extra}</span>
    </li>
  )
}
