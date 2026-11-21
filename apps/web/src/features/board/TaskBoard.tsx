import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PanelBoundary } from '@/shared/layout/RouteError'
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCorners, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Palette } from 'lucide-react'
import type { TaskListItem, TaskStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useLaneColors, useOlderDoneTasks, useSetLaneColor } from '@/features/tasks/api'
import { useBoardMoves, useTaskColumnMore, useTaskColumns } from '@/features/tasks/board-api'
import { TASK_COLUMN_PAGE, laneOf, type BoardQuery } from '@/features/tasks/board-columns'
import { ShowOlderDone } from '@/features/tasks/ShowOlderDone'
import { todayISO } from '@/features/tasks/board'
import { BOARD_LANES } from '@/features/tasks/delegation'
import { TaskCard } from '@/features/tasks/TaskCard'
import { useTaskActions, useTaskViewer } from '@/features/tasks/TaskActions'
import { TaskDrawer } from '@/features/tasks/TaskDrawer'

/**
 * The studio's tasks as a kanban: To do · In progress · Review · Blocked ·
 * Done. The order inside a lane is dragged by hand and shared. Cancelled work
 * is off the board (the list still has it).
 *
 * A page at a time (speed audit, 21 Nov): each lane reads its first 30 cards
 * and its own count from GET /tasks/columns, with the toolbar applied on the
 * server; "Show N more" brings the next 30 of that lane. Done holds the last
 * 30 days; older done tasks come in under it once it is all here.
 */
const LANES = BOARD_LANES

/**
 * Lane tints. Token pairs rather than hex, so a lane stays legible in both
 * schemes — a colour picked against a white panel goes muddy on a dark one.
 */
const LANE_COLORS = {
  default: { label: 'Default', head: 'bg-muted/30 border-border', dot: 'bg-muted-foreground/40' },
  slate: { label: 'Slate', head: 'bg-slate-500/10 border-slate-500/30', dot: 'bg-slate-500' },
  blue: { label: 'Blue', head: 'bg-sky-500/10 border-sky-500/30', dot: 'bg-sky-500' },
  green: { label: 'Green', head: 'bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-500' },
  amber: { label: 'Amber', head: 'bg-amber-500/10 border-amber-500/30', dot: 'bg-amber-500' },
  rose: { label: 'Rose', head: 'bg-rose-500/10 border-rose-500/30', dot: 'bg-rose-500' },
  violet: { label: 'Violet', head: 'bg-violet-500/10 border-violet-500/30', dot: 'bg-violet-500' },
} as const
type LaneColor = keyof typeof LANE_COLORS

type LaneView = ReturnType<typeof laneOf>

export function TaskBoard({
  query,
  scope = 'studio',
  olderFilter,
}: {
  /** The toolbar, applied on the server (GET /tasks/columns). */
  query: BoardQuery
  /** Whose older done tasks page in under Done. */
  scope?: 'studio' | 'my' | undefined
  /** The page's own filters, for the older done tasks (which come unfiltered). */
  olderFilter?: ((t: TaskListItem) => boolean) | undefined
}) {
  const board = useTaskColumns(query)
  const columnMore = useTaskColumnMore(query)
  const moves = useBoardMoves(query)
  const older = useOlderDoneTasks(scope)
  const olderRows = useMemo(() => (olderFilter ? older.rows.filter(olderFilter) : older.rows), [older.rows, olderFilter])
  const today = todayISO()
  const { me, canManage } = useTaskViewer()
  const actions = useTaskActions()
  const [openId, setOpenId] = useState<string | null>(null)
  const laneColors = useLaneColors()
  const setLaneColor = useSetLaneColor()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const lanes = useMemo(
    () => Object.fromEntries(LANES.map((l) => [l.key, laneOf(board.data, l.key, olderRows)])) as Record<TaskStatus, LaneView>,
    [board.data, olderRows],
  )
  const byId = useMemo(() => {
    const m = new Map<string, { task: TaskListItem; lane: TaskStatus }>()
    for (const l of LANES) for (const t of lanes[l.key].items) m.set(t.id, { task: t, lane: l.key })
    return m
  }, [lanes])

  // Selection never points at cards no longer on the board.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((id) => byId.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [byId])

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function bulkStatus(status: TaskStatus) {
    const tasks = [...selected].map((id) => byId.get(id)?.task).filter((t): t is TaskListItem => !!t)
    if (tasks.length === 0) return
    if (await moves.bulk(tasks, status)) setSelected(new Set())
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // A press-and-hold drags on a phone; a swipe still scrolls (audit, 18 Nov).
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    if (!e.over) return
    const overId = String(e.over.id)
    const from = byId.get(activeId)
    if (!from) return
    // over is either a card id or a lane droppable id ("lane:<status>")
    const to = overId.startsWith('lane:') ? (overId.slice(5) as TaskStatus) : byId.get(overId)?.lane
    if (!to) return
    // Only someone who manages tasks drags between lanes; the person on a
    // task uses its buttons (Done is a review, not a drag).
    if (!canManage) return
    const target = lanes[to].items
    if (from.lane === to) {
      const idx = target.findIndex((t) => t.id === activeId)
      const overIdx = target.findIndex((t) => t.id === overId)
      if (idx === -1 || overIdx === -1 || idx === overIdx) return
      void moves.reorder(to, arrayMove(target, idx, overIdx).map((t) => t.id))
      return
    }
    const overIdx = target.findIndex((t) => t.id === overId)
    void moves.drag(from.task, from.lane, to, overIdx === -1 ? target.length : overIdx)
  }

  if (board.isLoading) return <SkeletonCards count={3} />
  if (board.isError) return <ErrorState onRetry={() => void board.refetch()} />

  return (
    <>
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-xs text-muted-foreground">Move to:</span>
          {LANES.map((l) => (
            <Button key={l.key} size="sm" variant="outline" disabled={moves.pending} onClick={() => void bulkStatus(l.key)}>
              {l.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {LANES.map((lane) => {
            const l = lanes[lane.key]
            return (
              <Lane
                key={lane.key}
                laneKey={lane.key}
                label={lane.label}
                hint={lane.hint}
                tasks={l.items}
                count={l.count}
                color={(laneColors.data?.[lane.key] as LaneColor | undefined) ?? 'default'}
                onColor={canManage ? (c) => setLaneColor.mutate({ lane: lane.key, color: c }) : undefined}
                footer={
                  <>
                    <ShowMore
                      more={l.more}
                      loading={columnMore.loading === lane.key}
                      onShow={() => {
                        if (l.cursor) void columnMore.more(lane.key, l.cursor)
                      }}
                    />
                    {lane.key === 'completed' && !l.cursor && <ShowOlderDone older={older} className="mt-1 flex justify-center" />}
                  </>
                }
              >
                {(t) => (
                  <SortableCard key={t.id} id={t.id} disabled={!canManage || moves.pending}>
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
            )
          })}
        </div>
      </DndContext>
      {actions.dialogs}
      {openId && (
        <PanelBoundary resetKey={openId} label="this task">
          <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />
        </PanelBoundary>
      )}
    </>
  )
}

/** Under a lane that holds more than it shows: a bordered "Show N more" (the next 30 at most). */
function ShowMore({ more, onShow, loading }: { more: number; onShow: () => void; loading: boolean }) {
  if (more <= 0) return null
  return (
    <button
      type="button"
      onClick={onShow}
      disabled={loading}
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm hover:border-primary/50 hover:bg-muted"
    >
      {loading ? 'Loading…' : `Show ${Math.min(more, TASK_COLUMN_PAGE)} more`}
    </button>
  )
}

function Lane({
  laneKey,
  label,
  hint,
  tasks,
  count,
  color,
  onColor,
  footer,
  children,
}: {
  laneKey: TaskStatus
  label: string
  hint: string
  tasks: TaskListItem[]
  /** The lane's own total from the server, not the cards loaded. */
  count: number
  color: LaneColor
  onColor?: ((c: LaneColor) => void) | undefined
  footer?: ReactNode
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
          <span className="text-xs text-muted-foreground tabular-nums">{count.toLocaleString('en-IN')}</span>
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
      {footer}
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
