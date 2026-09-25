import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Search, X } from 'lucide-react'
import type { BoardDeliverable, Deliverable } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { MetricCard } from '@/shared/ui/metric-card'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { DeliverableDrawer } from '@/features/projects/DeliverableDrawer'
import { todayIso } from '@/features/projects/deliverable-stage'
import { useProductionBoard } from '@/features/board/api'
import { FOCI, applyFilters, focusCounts, lanesFor, type Focus } from '@/features/board/board-model'
import { StagesView } from '@/features/board/StagesView'
import { PeopleView } from '@/features/board/PeopleView'
import { TaskBoard } from '@/features/board/TaskBoard'
import { BulkBar } from '@/features/board/BulkBar'

type View = 'stages' | 'people' | 'tasks'

export function ProductionBoardPage() {
  return (
    <AuthedPage module="projects">
      <Board />
    </AuthedPage>
  )
}

/** A board card in the shape the deliverable panel reads. */
function asDeliverable(d: BoardDeliverable): Deliverable {
  return {
    ...d,
    list_key: 'primary',
    is_additional_charge: false,
    additional_charge_amount: 0,
    show_on_quotation: d.visibility_scope === 'client',
    start_rule: 'whole_project',
  }
}

const FOCUS_TONE: Record<Focus, 'danger' | 'warning' | 'accent' | 'muted'> = {
  late: 'danger',
  today: 'warning',
  review: 'accent',
  unassigned: 'warning',
}

/**
 * The production board: every deliverable in flight across the studio, by
 * stage and by person, with the four numbers that say where to look first.
 * Tasks keep their own kanban under the third tab.
 */
function Board() {
  const { data, isLoading, isError, refetch } = useProductionBoard()
  const access = useAccess()
  const { session } = useAuth()
  const navigate = useNavigate()
  const canEdit = access.hasAction('projects', 'edit')
  const canSeeTasks = access.hasModule('tasks')
  const me = session?.user_id ?? null

  const [viewParam, setView] = useUrlParam('view', 'stages')
  const [project, setProject] = useUrlParam('project')
  const [person, setPerson] = useUrlParam('person')
  const [focusParam, setFocus] = useUrlParam('focus')
  const [q, setQ] = useUrlParam('q')
  const view: View = viewParam === 'people' || (viewParam === 'tasks' && canSeeTasks) ? viewParam : 'stages'
  const focus = FOCI.some((f) => f.key === focusParam) ? (focusParam as Focus) : null

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const today = todayIso()

  const items = data?.items ?? []
  const stages = data?.stages ?? []
  const people = data?.people ?? []
  const lanes = useMemo(() => lanesFor(stages), [stages])

  // The figures count what the other filters allow, not the figure's own
  // filter -- tapping "Late" must not turn the other three to zero.
  const base = useMemo(() => applyFilters(items, { project, person, q }, today), [items, project, person, q, today])
  const counts = useMemo(() => focusCounts(base, today), [base, today])
  const shown = useMemo(() => (focus ? applyFilters(base, { focus }, today) : base), [base, focus, today])

  const projects = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of items) m.set(d.project_id, d.project_name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [items])

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const shownIds = new Set(shown.map((d) => d.id))
  const ticked = [...selected].filter((id) => shownIds.has(id))

  const open = openId ? items.find((d) => d.id === openId) : undefined
  const filtered = !!(project || person || q || focus)

  return (
    <>
      <PageHeader
        title="Production Board"
        description="Track work and delivery progress across every project. Assign, triage, and move deliverables forward from one place."
      />

      {isLoading ? (
        <SkeletonCards count={4} />
      ) : isError || !data ? (
        <ErrorState message="We could not load the production board." onRetry={() => void refetch()} />
      ) : (
        <>
          {view !== 'tasks' && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {FOCI.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={focus === f.key}
                  onClick={() => setFocus(focus === f.key ? '' : f.key)}
                  className={cn(
                    'h-full rounded-xl text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    focus === f.key ? 'ring-2 ring-primary' : 'hover:-translate-y-0.5',
                  )}
                >
                  <MetricCard
                    label={f.label}
                    value={counts[f.key]}
                    hint={f.key === 'review' ? 'someone must look at it' : `of ${counts.open} open`}
                    help={f.help}
                    tone={counts[f.key] > 0 ? FOCUS_TONE[f.key] : 'muted'}
                    className="h-full"
                  />
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FilterTabs<View>
              value={view}
              onChange={(v) => {
                setView(v)
                setSelected(new Set())
              }}
              tabs={[
                { value: 'stages', label: 'Stages' },
                { value: 'people', label: 'People' },
                ...(canSeeTasks ? [{ value: 'tasks' as const, label: 'Tasks' }] : []),
              ]}
            />
            <label className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search work, project, client…" aria-label="Search the board" className="pl-9" />
            </label>
            <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project" className="min-w-0 flex-1 sm:w-44 sm:flex-none">
              <option value="">All projects</option>
              {projects.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            <Select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person" className="min-w-0 flex-1 sm:w-44 sm:flex-none">
              <option value="">Everyone</option>
              <option value="none">Unassigned</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                </option>
              ))}
            </Select>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setProject('')
                  setPerson('')
                  setQ('')
                  setFocus('')
                }}
              >
                <X /> Clear
              </Button>
            )}
          </div>

          <div className="mt-4">
            {view === 'tasks' ? (
              <TaskBoard project={project || undefined} person={person || undefined} q={q || undefined} />
            ) : items.length === 0 ? (
              <EmptyState
                title="Nothing in production yet"
                description="Deliverables show here as soon as a project has them: add them on a project's Deliverables tab."
                action={
                  <Button asChild variant="outline">
                    <Link to="/projects">Open projects</Link>
                  </Button>
                }
              />
            ) : view === 'people' ? (
              <PeopleView
                items={shown}
                people={people}
                stages={stages}
                canEdit={canEdit}
                me={me}
                selected={selected}
                onToggle={toggle}
                onOpen={setOpenId}
                onlyPerson={person || undefined}
                canSeeTasks={canSeeTasks}
              />
            ) : (
              <StagesView items={shown} stages={stages} canEdit={canEdit} me={me} selected={selected} onToggle={toggle} onOpen={setOpenId} />
            )}
          </div>

          {view !== 'tasks' && (data.counts.dropped > 0 || data.counts.truncated) && (
            <p className="mt-2 text-xs text-muted-foreground">
              {data.counts.dropped > 0 && `${data.counts.dropped} dropped in the last fortnight. `}
              {data.counts.truncated && 'The board shows the first 1,000 open deliverables, soonest due first; filter by project to see the rest.'}
            </p>
          )}

          {view !== 'tasks' && canEdit && ticked.length > 0 && (
            <BulkBar ids={ticked} people={people} lanes={lanes} onDone={() => setSelected(new Set())} />
          )}
        </>
      )}

      <DeliverableDrawer
        deliverable={open ? asDeliverable(open) : null}
        canEdit={canEdit}
        onClose={() => setOpenId(null)}
        onEdit={(d) => void navigate({ to: '/projects/$id', params: { id: d.project_id }, search: { tab: 'deliverables' } as never })}
        onDelete={(d) => void navigate({ to: '/projects/$id', params: { id: d.project_id }, search: { tab: 'deliverables' } as never })}
      />
    </>
  )
}
