import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CalendarDays, Check, ChevronDown, ChevronRight, Package, Palette, Search, Users, X } from 'lucide-react'
import type { TaskListItem, TaskStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useBoard, useLaneColors, useSetBoardOrder, useSetLaneColor, useUpdateTask, useUpdateTaskStatus } from '@/features/tasks/api'
import { useBoardDeliverables } from '@/features/projects/api'
import { DueChip } from '@/features/projects/DeliverableCard'
import { STAGE_LABEL, STAGE_ORDER, stageOf } from '@/features/projects/deliverable-stage'

/**
 * Lane configuration: the four task stages plus the attention lenses the
 * studio triages by. Stages are the drag destinations; lenses only filter.
 */
const LANES: { key: TaskStatus; label: string; hint: string }[] = [
  { key: 'to_do', label: 'To do', hint: 'Not started yet' },
  { key: 'in_progress', label: 'In progress', hint: 'Being worked on' },
  { key: 'completed', label: 'Completed', hint: 'Done and approved' },
  { key: 'cancelled', label: 'Cancelled', hint: 'Dropped work' },
]

type BoardView = 'status' | 'people' | 'data'

const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

const today = () => new Date().toISOString().slice(0, 10)
const isLive = (t: TaskListItem) => t.status !== 'completed' && t.status !== 'cancelled'

function matchesDue(t: TaskListItem, mode: 'overdue' | 'today' | 'week' | 'none'): boolean {
  if (mode === 'none') return !t.due_date
  if (!t.due_date) return false
  const d = t.due_date
  if (mode === 'overdue') return d < today() && isLive(t)
  if (mode === 'today') return d === today()
  const week = new Date()
  week.setDate(week.getDate() + 7)
  return d >= today() && d <= week.toISOString().slice(0, 10)
}

/**
 * The six piles a studio triages by, mirroring the old board's strip.
 * "Needs attention" is the catch-all a morning stand-up actually looks at:
 * live work that is late, or has nobody on it.
 */
type FocusKey = 'overdue' | 'today' | 'pending_review' | 'in_progress' | 'completed' | 'attention' | null

const BUCKETS: ReadonlyArray<{ key: Exclude<FocusKey, null>; label: string; hint: string; empty: string }> = [
  { key: 'overdue', label: 'Overdue', hint: 'Past the due date', empty: 'Nothing late' },
  { key: 'today', label: 'Due today', hint: 'Due before tonight', empty: 'No items due today' },
  { key: 'pending_review', label: 'Pending review', hint: 'Waiting on a reviewer', empty: 'Nothing to review' },
  { key: 'in_progress', label: 'In progress', hint: 'Active work', empty: 'Nothing started' },
  { key: 'completed', label: 'Completed', hint: 'Done & delivered', empty: 'Nothing finished yet' },
  { key: 'attention', label: 'Needs attention', hint: 'Late or unowned', empty: 'All clear' },
]

function inBucket(t: TaskListItem, key: Exclude<FocusKey, null>): boolean {
  switch (key) {
    case 'overdue':
      return !!t.due_date && t.due_date < today() && isLive(t)
    case 'today':
      return t.due_date === today() && isLive(t)
    case 'pending_review':
      return t.custom_status_code === 'pending_review'
    case 'in_progress':
      return t.status === 'in_progress'
    case 'completed':
      return t.status === 'completed'
    case 'attention':
      return isLive(t) && ((!!t.due_date && t.due_date < today()) || t.assignee_names.length === 0)
  }
}

/**
 * Lane tints. Token pairs rather than hex, so a lane stays legible in both
 * schemes — a colour picked against a white panel goes muddy on a dark one.
 */
export const LANE_COLORS = {
  default: { label: 'Default', head: 'bg-muted/30 border-border', dot: 'bg-muted-foreground/40' },
  slate: { label: 'Slate', head: 'bg-slate-500/10 border-slate-500/30', dot: 'bg-slate-500' },
  blue: { label: 'Blue', head: 'bg-sky-500/10 border-sky-500/30', dot: 'bg-sky-500' },
  green: { label: 'Green', head: 'bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-500' },
  amber: { label: 'Amber', head: 'bg-amber-500/10 border-amber-500/30', dot: 'bg-amber-500' },
  rose: { label: 'Rose', head: 'bg-rose-500/10 border-rose-500/30', dot: 'bg-rose-500' },
  violet: { label: 'Violet', head: 'bg-violet-500/10 border-violet-500/30', dot: 'bg-violet-500' },
} as const
export type LaneColor = keyof typeof LANE_COLORS

type Lanes = Record<TaskStatus, TaskListItem[]>

export function ProductionBoardPage() {
  return (
    <AuthedPage module="tasks">
      <Board />
    </AuthedPage>
  )
}

function groupByLane(items: TaskListItem[]): Lanes {
  const lanes: Lanes = { to_do: [], in_progress: [], completed: [], cancelled: [] }
  for (const t of items) lanes[t.status].push(t)
  for (const key of Object.keys(lanes) as TaskStatus[]) {
    lanes[key].sort((a, b) => a.sort_order - b.sort_order)
  }
  return lanes
}

function Board() {
  const { data, isLoading, isError, refetch } = useBoard()
  const setOrder = useSetBoardOrder()
  const updateStatus = useUpdateTaskStatus()
  const laneColors = useLaneColors()
  const setLaneColor = useSetLaneColor()
  const [view, setView] = useState<BoardView>('status')
  const [search, setSearch] = useState('')
  const [project, setProject] = useState('all')
  const [priority, setPriority] = useState('all')
  const [assignee, setAssignee] = useState('all')
  const [due, setDue] = useState<'all' | 'overdue' | 'today' | 'week' | 'none'>('all')
  const [assignment, setAssignment] = useState<'all' | 'assigned' | 'unassigned'>('all')
  /** The KPI chip currently acting as a filter, if any. */
  const [focus, setFocus] = useState<FocusKey>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [lanes, setLanes] = useState<Lanes>(() => groupByLane([]))

  const projectOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of data ?? []) if (t.project_id) m.set(t.project_id, t.project_name ?? t.project_id)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data])

  const assigneeOptions = useMemo(() => {
    const s = new Set<string>()
    for (const t of data ?? []) for (const n of t.assignee_names) s.add(n)
    return [...s].sort()
  }, [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data ?? []).filter((t) => {
      if (project !== 'all' && t.project_id !== project) return false
      if (priority !== 'all' && t.priority !== priority) return false
      if (assignee !== 'all' && !t.assignee_names.includes(assignee)) return false
      if (assignment === 'assigned' && t.assignee_names.length === 0) return false
      if (assignment === 'unassigned' && t.assignee_names.length > 0) return false
      if (due !== 'all' && !matchesDue(t, due)) return false
      if (focus && !inBucket(t, focus)) return false
      if (q && !`${t.title} ${t.project_name ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, search, project, priority, assignee, assignment, due, focus])

  /**
   * Counts for the KPI strip. Computed over everything the other filters
   * allow but WITHOUT the chip's own filter applied — otherwise selecting
   * "Overdue" would drop every other count to zero and the strip would stop
   * being a way to navigate.
   */
  const buckets = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = (data ?? []).filter((t) => {
      if (project !== 'all' && t.project_id !== project) return false
      if (priority !== 'all' && t.priority !== priority) return false
      if (assignee !== 'all' && !t.assignee_names.includes(assignee)) return false
      if (assignment === 'assigned' && t.assignee_names.length === 0) return false
      if (assignment === 'unassigned' && t.assignee_names.length > 0) return false
      if (due !== 'all' && !matchesDue(t, due)) return false
      if (q && !`${t.title} ${t.project_name ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
    return BUCKETS.map((b) => ({ ...b, count: base.filter((t) => inBucket(t, b.key)).length }))
  }, [data, search, project, priority, assignee, assignment, due])

  // Selection never points at rows the filters have hidden.
  const visibleIds = useMemo(() => new Set(filtered.map((t) => t.id)), [filtered])
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((id) => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleIds])

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function bulkStatus(status: TaskStatus) {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      await Promise.all(ids.map((taskId) => updateStatus.mutateAsync({ id: taskId, status })))
      toast.success(`${ids.length} task${ids.length === 1 ? '' : 's'} moved`)
      setSelected(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move every task.')
    }
  }

  useEffect(() => {
    if (data) setLanes(groupByLane(filtered))
  }, [data, filtered])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const laneOf = useMemo(() => {
    const m = new Map<string, TaskStatus>()
    for (const key of Object.keys(lanes) as TaskStatus[]) for (const t of lanes[key]) m.set(t.id, key)
    return m
  }, [lanes])

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    if (!e.over) return
    const overId = String(e.over.id)
    const from = laneOf.get(activeId)
    if (!from) return
    // over is either a card id or a lane droppable id ("lane:<status>")
    const to = overId.startsWith('lane:') ? (overId.slice(5) as TaskStatus) : laneOf.get(overId)
    if (!to) return

    setLanes((prev) => {
      const next: Lanes = {
        to_do: [...prev.to_do],
        in_progress: [...prev.in_progress],
        completed: [...prev.completed],
        cancelled: [...prev.cancelled],
      }
      const idx = next[from].findIndex((t) => t.id === activeId)
      if (idx === -1) return prev

      if (from === to) {
        const overIdx = next[to].findIndex((t) => t.id === overId)
        if (overIdx !== -1 && overIdx !== idx) next[to] = arrayMove(next[to], idx, overIdx)
      } else {
        const [moved] = next[from].splice(idx, 1)
        if (!moved) return prev
        const overIdx = next[to].findIndex((t) => t.id === overId)
        const insertAt = overIdx === -1 ? next[to].length : overIdx
        next[to].splice(insertAt, 0, { ...moved, status: to })
      }

      // Persist: target lane order (+ source lane if changed) and the status move.
      void setOrder.mutateAsync({
        board_view: 'default',
        lane_key: to,
        task_ids: next[to].map((t) => t.id),
      })
      if (from !== to) {
        void setOrder.mutateAsync({
          board_view: 'default',
          lane_key: from,
          task_ids: next[from].map((t) => t.id),
        })
        void updateStatus.mutateAsync({ id: activeId, status: to })
      }
      return next
    })
  }

  if (isLoading) return <SkeletonCards count={3} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  const total = filtered.length
  const unassigned = filtered.filter((t) => t.assignee_names.length === 0).length
  const overdue = filtered.filter((t) => t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== 'completed' && t.status !== 'cancelled').length

  return (
    <>
      <PageHeader title="Production board" description="Drag cards to reorder or change stage." />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="tablist" aria-label="Board view">
          {(['status', 'people', 'data'] as BoardView[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium capitalize transition-colors',
                view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v === 'status' ? 'Status' : v === 'people' ? 'People' : 'Data'}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {total} card{total === 1 ? '' : 's'}
          {unassigned > 0 && ` · ${unassigned} unassigned`}
          {overdue > 0 && ` · ${overdue} overdue`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <label className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or project…" aria-label="Search board" className="pl-9" />
        </label>
        <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project" className="w-44">
          <option value="all">All projects</option>
          {projectOptions.map(([pid, name]) => <option key={pid} value={pid}>{name}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority" className="w-36">
          <option value="all">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Filter by assignee" className="w-44">
          <option value="all">Any assignee</option>
          {assigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <Select value={due} onChange={(e) => setDue(e.target.value as typeof due)} aria-label="Filter by due date" className="w-40">
          <option value="all">Any due</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Due this week</option>
          <option value="none">No due date</option>
        </Select>
        <Select
          value={assignment}
          onChange={(e) => setAssignment(e.target.value as typeof assignment)}
          aria-label="Filter by assignment"
          className="w-48"
        >
          <option value="all">Assigned + Unassigned</option>
          <option value="assigned">Assigned only</option>
          <option value="unassigned">Unassigned only</option>
        </Select>
        {(search || project !== 'all' || priority !== 'all' || assignee !== 'all' || due !== 'all' || assignment !== 'all' || focus) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              setProject('all')
              setPriority('all')
              setAssignee('all')
              setDue('all')
              setAssignment('all')
              setFocus(null)
            }}
          >
            <X /> Clear
          </Button>
        )}
      </div>

      {/* The triage strip: how much is on fire, and a way into each pile. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {buckets.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-pressed={focus === b.key}
            onClick={() => setFocus((f) => (f === b.key ? null : b.key))}
            className={cn(
              'rounded-lg border p-3 text-left transition',
              focus === b.key ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40',
            )}
          >
            <span className="block text-xs text-muted-foreground">{b.label}</span>
            <span className="mt-0.5 block text-xl font-semibold tabular-nums">{b.count}</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {b.count === 0 ? b.empty : b.hint}
            </span>
          </button>
        ))}
      </div>

      <DeliverablesStrip />

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-xs text-muted-foreground">Move to:</span>
          {LANES.map((l) => (
            <Button key={l.key} size="sm" variant="outline" disabled={updateStatus.isPending} onClick={() => void bulkStatus(l.key)}>
              {l.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {view === 'people' ? (
        <PeopleView tasks={filtered} />
      ) : view === 'data' ? (
        <DataView tasks={filtered} />
      ) : (
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {LANES.map((lane) => (
            <Lane
              key={lane.key}
              laneKey={lane.key}
              label={lane.label}
              hint={lane.hint}
              tasks={lanes[lane.key]}
              selected={selected}
              onToggleSelect={toggleSelect}
              color={(laneColors.data?.[lane.key] as LaneColor | undefined) ?? 'default'}
              onColor={(c) => setLaneColor.mutate({ lane: lane.key, color: c })}
            />
          ))}
        </div>
      </DndContext>
      )}
    </>
  )
}

/**
 * Deliverable cards across every project, in the four stages the project page
 * uses. Tasks are the drag destinations above; this strip answers "what is
 * promised and where is it" without leaving the board.
 */
function DeliverablesStrip() {
  const { data, isLoading } = useBoardDeliverables()
  const [open, setOpen] = useState(false)

  // The same four stages as the project page, so nothing falls between lanes.
  const groups = useMemo(
    () =>
      STAGE_ORDER.map((stage) => ({
        lane: { key: stage, label: STAGE_LABEL[stage] },
        items: (data ?? []).filter((d) => stageOf(d.status) === stage),
      })).filter((g) => g.items.length > 0),
    [data],
  )

  const total = (data ?? []).length
  if (isLoading || total === 0) return null

  return (
    <Card className="mt-3">
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-medium transition-colors hover:bg-accent"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <Package className="size-4 text-muted-foreground" aria-hidden />
          Deliverables on the board ({total})
          <span className="ml-1 flex flex-wrap gap-1">
            {groups.map((g) => (
              <StatusBadge key={g.lane.key} tone="neutral">
                {g.lane.label} · {g.items.length}
              </StatusBadge>
            ))}
          </span>
        </button>
        {open && (
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {groups.map((g) => (
              <div key={g.lane.key} className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.lane.label} ({g.items.length})
                </p>
                {g.items.slice(0, 6).map((d) => (
                  <div key={d.id} className="rounded-md border border-border bg-card p-2.5">
                    <p className="truncate text-sm font-medium" title={d.title}>{d.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {d.project_name ?? 'No project'}
                      {d.shoot_name ? ` · ${d.shoot_name}` : ''}
                      {` · ${d.assignee_name ?? 'No editor'}`}
                    </p>
                    <DueChip d={{ status: d.status, estimated_date: d.due_date }} />
                    {d.project_id && (
                      <Link
                        to="/projects/$id"
                        params={{ id: d.project_id }}
                        search={{ tab: 'deliverables' }}
                        className="mt-1 block text-xs font-medium text-primary hover:underline"
                      >
                        Open project
                      </Link>
                    )}
                  </div>
                ))}
                {g.items.length > 6 && (
                  <p className="px-1 text-xs text-muted-foreground">+ {g.items.length - 6} more</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PeopleView({ tasks }: { tasks: TaskListItem[] }) {
  const lanes = useMemo(() => {
    const m = new Map<string, TaskListItem[]>()
    m.set('Unassigned', [])
    for (const t of tasks) {
      if (t.assignee_names.length === 0) m.get('Unassigned')!.push(t)
      else for (const n of t.assignee_names) m.set(n, [...(m.get(n) ?? []), t])
    }
    return [...m.entries()].sort((a, b) => (a[0] === 'Unassigned' ? -1 : b[0] === 'Unassigned' ? 1 : b[1].length - a[1].length || a[0].localeCompare(b[0])))
  }, [tasks])
  if (tasks.length === 0) return <EmptyState title="Nothing here" description="No cards match these filters." />
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {lanes.map(([name, items]) => (
        <div key={name} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between px-1">
            <span className="flex items-center gap-1.5 text-sm font-medium"><Users className="size-4 text-muted-foreground" />{name}</span>
            <span className="text-xs text-muted-foreground">{items.length}</span>
          </div>
          {items.map((t) => (
            <div key={t.id} className="rounded-md border border-border bg-card p-3 shadow-sm">
              <p className="text-sm font-medium">{t.title}</p>
              {t.project_name && <p className="mt-0.5 text-xs text-muted-foreground">{t.project_name}</p>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function DataView({ tasks }: { tasks: TaskListItem[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today && t.status !== 'completed' && t.status !== 'cancelled')
  const dueWeek = tasks.filter((t) => t.due_date && t.due_date >= today && t.due_date <= today.slice(0, 8) + '31')
  const unassigned = tasks.filter((t) => t.assignee_names.length === 0 && t.status !== 'completed' && t.status !== 'cancelled')
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold text-destructive">Overdue ({overdue.length})</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {overdue.slice(0, 8).map((t) => (
            <li key={t.id} className="truncate">{t.title} <span className="text-xs text-muted-foreground">· due {t.due_date}</span></li>
          ))}
          {overdue.length === 0 && <li className="text-sm text-muted-foreground">Nothing late.</li>}
        </ul>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">Due this month ({dueWeek.length})</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {dueWeek.slice(0, 8).map((t) => (
            <li key={t.id} className="truncate">{t.title} <span className="text-xs text-muted-foreground">· due {t.due_date}</span></li>
          ))}
          {dueWeek.length === 0 && <li className="text-sm text-muted-foreground">Nothing due.</li>}
        </ul>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">Needs an owner ({unassigned.length})</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {unassigned.slice(0, 8).map((t) => (
            <li key={t.id} className="truncate">{t.title} <span className="text-xs text-muted-foreground">· {t.project_name ?? 'no project'}</span></li>
          ))}
          {unassigned.length === 0 && <li className="text-sm text-muted-foreground">Everything has an owner.</li>}
        </ul>
      </div>
    </div>
  )
}

function Lane({
  laneKey,
  label,
  hint,
  tasks,
  selected,
  onToggleSelect,
  color,
  onColor,
}: {
  laneKey: TaskStatus
  label: string
  hint: string
  tasks: TaskListItem[]
  selected: ReadonlySet<string>
  onToggleSelect: (id: string) => void
  color: LaneColor
  onColor: (c: LaneColor) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${laneKey}` })
  const [picking, setPicking] = useState(false)
  const tint = LANE_COLORS[color]
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-40 flex-col gap-2 rounded-lg border p-3 transition-colors',
        isOver ? 'border-primary bg-primary/5' : tint.head,
      )}
    >
      <div className="flex items-center justify-between px-1">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium" title={hint}>
          <span className={cn('size-2 shrink-0 rounded-full', tint.dot)} aria-hidden />
          {label}
        </span>
        <span className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{tasks.length}</span>
          <button
            type="button"
            aria-label={`Change ${label} lane colour`}
            onClick={() => setPicking((v) => !v)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <Palette className="size-3.5" />
          </button>
        </span>
      </div>
      {picking && (
        <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-card p-2">
          {(Object.keys(LANE_COLORS) as LaneColor[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-label={LANE_COLORS[key].label}
              aria-pressed={color === key}
              title={LANE_COLORS[key].label}
              onClick={() => {
                onColor(key)
                setPicking(false)
              }}
              className={cn(
                'size-5 rounded-full border transition',
                LANE_COLORS[key].dot,
                color === key ? 'ring-2 ring-primary ring-offset-1' : 'border-border',
              )}
            />
          ))}
        </div>
      )}
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} ticked={selected.has(t.id)} onToggle={() => onToggleSelect(t.id)} />
        ))}
      </SortableContext>
    </div>
  )
}

function TaskCard({ task, ticked, onToggle }: { task: TaskListItem; ticked: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })
  const [open, setOpen] = useState(false)
  const setStatus = useUpdateTaskStatus()
  const updateTask = useUpdateTask()
  const overdue = !!task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== 'completed' && task.status !== 'cancelled'
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`cursor-grab rounded-md border border-border bg-card p-3 shadow-sm ${
        isDragging ? 'opacity-50' : ''
      } ${ticked ? 'ring-2 ring-primary/50' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-1.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={ticked}
            aria-label={`Select ${task.title}`}
            onClick={(e) => { e.stopPropagation(); onToggle() }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
              ticked ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:border-primary/50',
            )}
          >
            {ticked && <Check className="size-2.5" aria-hidden />}
          </button>
          <p className="min-w-0 text-sm font-medium">{task.title}</p>
        </span>
        <StatusBadge tone={PRIORITY_TONE[task.priority]}>{task.priority}</StatusBadge>
      </div>
      {task.project_name && (
        <p className="mt-1 text-xs text-muted-foreground">{task.project_name}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {task.due_date && (
          <span className={cn('flex items-center gap-1', overdue && 'font-medium text-destructive')}>
            <CalendarDays className="size-3" /> {task.due_date}{overdue ? ' · overdue' : ''}
          </span>
        )}
        {task.assignee_names.length > 0 && (
          <span className="flex items-center gap-1">
            <Users className="size-3" /> {task.assignee_names.slice(0, 2).join(', ')}
            {task.assignee_names.length > 2 ? ` +${task.assignee_names.length - 2}` : ''}
          </span>
        )}
      </div>

      {/* Details in place. Opening a dialog to read one line of description
          loses your position on a board you are triaging down. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-expanded={open}
        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
      >
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} aria-hidden />
        {open ? 'Hide details' : 'Details'}
      </button>

      {open && (
        <div
          className="mt-2 flex flex-col gap-2 border-t border-border pt-2 text-[11px]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {task.description ? (
            <p className="whitespace-pre-wrap text-muted-foreground">{task.description}</p>
          ) : (
            <p className="text-muted-foreground">No description.</p>
          )}
          {task.assignee_names.length > 0 && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Assigned:</span> {task.assignee_names.join(', ')}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Status</span>
              <Select
                value={task.status}
                aria-label={`Change status of ${task.title}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation()
                  setStatus.mutate({ id: task.id, status: e.target.value as TaskStatus })
                }}
                className="h-8 text-xs"
              >
                {LANES.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Priority</span>
              <Select
                value={task.priority}
                aria-label={`Change priority of ${task.title}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation()
                  updateTask.mutate({ id: task.id, patch: { priority: e.target.value as TaskListItem['priority'] } })
                }}
                className="h-8 text-xs"
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
