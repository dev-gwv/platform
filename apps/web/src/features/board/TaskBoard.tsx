import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, closestCorners, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { Palette } from 'lucide-react'
import type { TaskListItem, TaskStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useBoard, useLaneColors, useSetBoardOrder, useSetLaneColor, useUpdateTaskStatus } from '@/features/tasks/api'
import { todayISO } from '@/features/tasks/board'
import { BOARD_LANES } from '@/features/tasks/delegation'
import { TaskCard } from '@/features/tasks/TaskCard'
import { useTaskActions, useTaskViewer } from '@/features/tasks/TaskActions'
import { TaskDrawer } from '@/features/tasks/TaskDrawer'

/**
 * The studio's tasks as a kanban: To do · In progress · Review · Blocked ·
 * Done. The order inside a lane is dragged by hand and shared. Cancelled work
 * is off the board (the list still has it).
 */
const LANES = BOARD_LANES

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

export function TaskBoard({
  project,
  person,
  q,
  items,
  filter,
}: {
  project?: string | undefined
  person?: string | undefined
  q?: string | undefined
  /** Rows to show instead of the studio board (someone who sees only their own). */
  items?: readonly TaskListItem[] | undefined
  /** The page's own filters (mine, member, due date). */
  filter?: ((t: TaskListItem) => boolean) | undefined
}) {
  const board = useBoard()
  const data = items ?? board.data
  const { isLoading, isError, refetch } = items ? { isLoading: false, isError: false, refetch: board.refetch } : board
  const today = todayISO()
  const { me, canManage } = useTaskViewer()
  const actions = useTaskActions()
  const [openId, setOpenId] = useState<string | null>(null)
  const setOrder = useSetBoardOrder()
  const updateStatus = useUpdateTaskStatus()
  const laneColors = useLaneColors()
  const setLaneColor = useSetLaneColor()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [lanes, setLanes] = useState<Lanes>(() => groupByLane([]))

  const filtered = useMemo(() => {
    const needle = (q ?? '').trim().toLowerCase()
    return (data ?? []).filter((t) => {
      if (filter && !filter(t)) return false
      if (project && t.project_id !== project) return false
      if (person === 'none' ? t.assignee_ids.length > 0 : person && !t.assignee_ids.includes(person)) return false
      if (needle && !`${t.title} ${t.project_name ?? ''}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [data, project, person, q, filter])

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
    // Only someone who manages tasks drags between lanes; the person on a
    // task uses its buttons (Done is a review, not a drag).
    if (!canManage) return

    setLanes((prev) => {
      const next: Lanes = {
        to_do: [...prev.to_do],
        in_progress: [...prev.in_progress],
        review: [...prev.review],
        blocked: [...prev.blocked],
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
      void setOrder.mutateAsync({ board_view: 'default', lane_key: to, task_ids: next[to].map((t) => t.id) })
      if (from !== to) {
        void setOrder.mutateAsync({ board_view: 'default', lane_key: from, task_ids: next[from].map((t) => t.id) })
        void updateStatus.mutateAsync({ id: activeId, status: to })
      }
      return next
    })
  }

  if (isLoading) return <SkeletonCards count={3} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  return (
    <>
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
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
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {LANES.map((lane) => (
            <Lane
              key={lane.key}
              laneKey={lane.key}
              label={lane.label}
              hint={lane.hint}
              tasks={lanes[lane.key]}
              color={(laneColors.data?.[lane.key] as LaneColor | undefined) ?? 'default'}
              onColor={canManage ? (c) => setLaneColor.mutate({ lane: lane.key, color: c }) : undefined}
            >
              {(t) => (
                <SortableCard key={t.id} id={t.id} disabled={!canManage}>
                  <TaskCard
                    task={t}
                    today={today}
                    me={me}
                    canManage={canManage}
                    onOpen={(x) => setOpenId(x.id)}
                    onAction={actions.run}
                    {...(canManage ? { select: { ticked: selected.has(t.id), onToggle: () => toggleSelect(t.id) } } : {})}
                  />
                </SortableCard>
              )}
            </Lane>
          ))}
        </div>
      </DndContext>
      {actions.dialogs}
      {openId && <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}

function groupByLane(items: TaskListItem[]): Lanes {
  const lanes: Lanes = { to_do: [], in_progress: [], review: [], blocked: [], completed: [], cancelled: [] }
  for (const t of items) lanes[t.status].push(t)
  for (const key of Object.keys(lanes) as TaskStatus[]) {
    lanes[key].sort((a, b) => a.sort_order - b.sort_order)
  }
  return lanes
}

function Lane({
  laneKey,
  label,
  hint,
  tasks,
  color,
  onColor,
  children,
}: {
  laneKey: TaskStatus
  label: string
  hint: string
  tasks: TaskListItem[]
  color: LaneColor
  onColor?: ((c: LaneColor) => void) | undefined
  children: (t: TaskListItem) => ReactNode
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
          {onColor && <button
            type="button"
            aria-label={`Change ${label} lane colour`}
            onClick={() => setPicking((v) => !v)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <Palette className="size-3.5" />
          </button>}
        </span>
      </div>
      {picking && onColor && (
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
        {tasks.map((t) => children(t))}
      </SortableContext>
    </div>
  )
}

function SortableCard({ id, disabled, children }: { id: string; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(!disabled && 'cursor-grab', isDragging && 'opacity-50')}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}
