import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Briefcase, CalendarDays, CircleCheck, Clock, Download, ExternalLink, FileText, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { projectListPage, type ProjectListItem, type ProjectStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Select } from '@/shared/ui/input'
import { RowMenu } from '@/shared/ui/row-menu'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatINR, humanize } from '@/shared/ui/format'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { useIssueQuotation, useProjectsPage, useDeleteProject } from '@/features/projects/api'

type Filter = ProjectStatus | 'all'
type ProjectSort = 'recent' | 'oldest' | 'name' | 'pending_desc' | 'upcoming' | 'value_desc'

/** Each option sorts by exactly what it says. */
const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: 'recent', label: 'Newest first' },
  { value: 'upcoming', label: 'Next shoot first' },
  { value: 'pending_desc', label: 'Most money due' },
  { value: 'value_desc', label: 'Highest value' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'oldest', label: 'Oldest first' },
]

const STATUS_TONE: Record<ProjectStatus, 'info' | 'success' | 'danger' | 'warning'> = {
  active: 'info',
  completed: 'success',
  cancelled: 'danger',
  on_hold: 'warning',
}

const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const due = (p: ProjectListItem) => Math.max(0, p.total_cost - p.received)

export function ProjectsListPage() {
  return (
    <AuthedPage module="projects">
      <ProjectsList />
    </AuthedPage>
  )
}

/**
 * Every booked project: what it is worth, what has come in, what is still
 * due, and when its next shoot is. The figures on top cover everything the
 * filter matches, not just the page on screen.
 */
function ProjectsList() {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ProjectSort>('recent')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const pageSize = 20
  const query = {
    ...(filter !== 'all' ? { status: filter } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    sort,
  }
  const { data: paged, isLoading, isError, refetch } = useProjectsPage({ page, page_size: pageSize, ...query })
  const rows = paged?.items ?? []
  const total = paged?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const counts = paged?.status_counts ?? {}
  const allCount = Object.values(counts).reduce((n, c) => n + c, 0)
  const isMobile = useIsMobile()
  const filtered = filter !== 'all' || !!search.trim()

  // Everything the filter matches, a page at a time, then one CSV.
  async function exportCsv() {
    setExporting(true)
    try {
      const all: ProjectListItem[] = []
      for (let p = 1; p <= 20; p++) {
        const params = new URLSearchParams({ page: String(p), page_size: '100', sort })
        if (query.status) params.set('status', query.status)
        if (query.search) params.set('search', query.search)
        const res = await callApi(`/projects?${params.toString()}`, { responseSchema: projectListPage })
        all.push(...res.items)
        if (all.length >= res.total || res.items.length === 0) break
      }
      downloadCsv(
        'projects.csv',
        toCsv(
          ['Project', 'Client', 'Phone', 'Status', 'Next shoot', 'Value', 'Received', 'Due', 'Created'],
          all.map((p) => [
            p.name,
            p.client_name ?? '',
            p.client_phone ?? '',
            humanize(p.status),
            p.next_shoot_date ? shortDay(p.next_shoot_date) : '',
            p.total_cost,
            p.received,
            due(p),
            shortDay(p.created_at),
          ]),
        ),
      )
    } catch {
      toast.error('Could not export — please try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', to: '/dashboard' }, { label: 'Projects' }]} />

      <PageHeader
        title="All Projects"
        description="Every booked project — what it's worth, what's come in, and what's still due."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void exportCsv()} disabled={total === 0 || exporting}>
              <Download /> {exporting ? 'Exporting…' : 'Export'}
            </Button>
            <Button asChild>
              <Link to="/projects/new">
                <Plus /> New project
              </Link>
            </Button>
          </div>
        }
      />

      <Card className="mt-4">
        <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Figure icon={Briefcase} label={filtered ? 'Projects shown' : 'Projects'} value={String(total)} />
          <Figure icon={Briefcase} label="Total value" value={formatINR(paged?.summary.value ?? 0)} />
          <Figure icon={CircleCheck} label="Received" value={formatINR(paged?.summary.received ?? 0)} tone="success" />
          <Figure icon={Clock} label="Still to collect" value={formatINR(paged?.summary.due ?? 0)} tone="warning" />
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <FilterTabs<Filter>
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setPage(1)
          }}
          tabs={[
            { value: 'all', label: 'All', count: allCount },
            { value: 'active', label: 'Active', count: counts.active ?? 0 },
            { value: 'on_hold', label: 'On hold', count: counts.on_hold ?? 0 },
            { value: 'completed', label: 'Completed', count: counts.completed ?? 0 },
            { value: 'cancelled', label: 'Cancelled', count: counts.cancelled ?? 0 },
          ]}
        />
        <div className="flex flex-1 items-center gap-2 lg:justify-end">
          <label className="relative flex-1 lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search project, client or phone…"
              aria-label="Search projects"
              className="pl-9"
            />
          </label>
          <Select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as ProjectSort)
              setPage(1)
            }}
            className="w-44"
            aria-label="Sort projects"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonList rows={5} columns={6} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title="Nothing matches"
              description="Try another status, or clear the search."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setFilter('all')
                    setPage(1)
                  }}
                >
                  <X /> Clear
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No projects yet"
              description="Create your first project to start tracking shoots, work and payments."
              action={
                <Button asChild>
                  <Link to="/projects/new">
                    <Plus /> New project
                  </Link>
                </Button>
              }
            />
          )
        ) : isMobile ? (
          <ul className="flex flex-col gap-2">
            {rows.map((p) => (
              <li key={p.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-2">
                  <Link to="/projects/$id" params={{ id: p.id }} className="min-w-0 flex-1">
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {p.client_name ?? '—'}
                      {p.client_phone ? ` · ${p.client_phone}` : ''}
                    </span>
                  </Link>
                  <StatusBadge tone={STATUS_TONE[p.status]}>{humanize(p.status)}</StatusBadge>
                  <ProjectMenu project={p} />
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 text-sm">
                  <span className="font-semibold">{formatINR(p.total_cost)}</span>
                  <span className="text-success">{formatINR(p.received)} in</span>
                  {due(p) > 0 && <span className="text-warning">{formatINR(due(p))} due</span>}
                  {p.next_shoot_date && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <CalendarDays className="size-3.5" aria-hidden /> {shortDay(p.next_shoot_date)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="table-wrap rounded-lg border border-border">
            <table className="table-sticky w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Next shoot</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                  <th className="px-4 py-2.5 text-right font-medium">Received</th>
                  <th className="px-4 py-2.5 text-right font-medium">Due</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link to="/projects/$id" params={{ id: p.id }} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {p.client_name ?? '—'}
                        {p.client_phone ? ` · ${p.client_phone}` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.next_shoot_date ? shortDay(p.next_shoot_date) : '—'}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge tone={STATUS_TONE[p.status]}>{humanize(p.status)}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatINR(p.total_cost)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', p.received > 0 ? 'text-success' : 'text-muted-foreground')}>
                      {formatINR(p.received)}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', due(p) > 0 ? 'font-medium text-warning' : 'text-muted-foreground')}>
                      {formatINR(due(p))}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <ProjectMenu project={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {total} projects
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((n) => Math.min(totalPages, n + 1))}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/** Open, edit, copy the quotation link, delete. Delete explains itself when the server refuses. */
function ProjectMenu({ project }: { project: ProjectListItem }) {
  const navigate = useNavigate()
  const issue = useIssueQuotation()
  const del = useDeleteProject()
  const confirm = useConfirm()
  return (
    <RowMenu
      label={`More for ${project.name}`}
      items={[
        { label: 'Open project', icon: <ExternalLink className="size-4" />, onSelect: () => void navigate({ to: '/projects/$id', params: { id: project.id } }) },
        { label: 'Edit project', icon: <Pencil className="size-4" />, onSelect: () => void navigate({ to: '/projects/$id/edit', params: { id: project.id } }) },
        {
          label: 'Copy quotation link',
          icon: <FileText className="size-4" />,
          disabled: issue.isPending,
          onSelect: () =>
            issue.mutate(
              { project_id: project.id, notes: null },
              {
                onSuccess: (r) => {
                  void navigator.clipboard?.writeText(r.link)
                  toast.success('Quotation link copied')
                },
              },
            ),
        },
        {
          label: 'Delete project',
          icon: <Trash2 className="size-4" />,
          disabled: del.isPending,
          onSelect: async () => {
            const yes = await confirm({
              title: `Delete ${project.name}?`,
              description: 'Its shoots, deliverables and tasks go with it. A project with payments can’t be deleted — mark it Cancelled instead.',
              confirmLabel: 'Delete project',
              destructive: true,
            })
            if (yes) del.mutate(project.id)
          },
        },
      ]}
    />
  )
}

/** One figure in the summary bar. */
function Figure({ icon: Icon, label, value, tone }: { icon: typeof Briefcase; label: string; value: string; tone?: 'success' | 'warning' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          tone === 'success' ? 'bg-success/10 text-success' : tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  )
}
