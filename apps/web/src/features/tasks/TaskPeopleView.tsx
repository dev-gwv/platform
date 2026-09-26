import { useMemo, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { UserRound } from 'lucide-react'
import type { DirectoryMember, TaskListItem } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { cn } from '@/shared/ui/cn'
import { collide, useBoardSensors } from '@/features/board/StagesView'
import { useUpdateTask } from './api'
import { groupByPerson, type PersonColumn } from './board'
import { reassigned, type QuickAction } from './delegation'
import { TaskCard } from './TaskCard'

interface DragData {
  task: TaskListItem
  /** The column it was picked up from: the person it is being taken off. */
  from: string | null
}

/**
 * Everyone and what they are carrying, one column each, late work first.
 * Someone who assigns work drags a card onto another person to hand it over;
 * the people with nothing open sit along the bottom, ready to take something.
 */
export function TaskPeopleView({
  rows,
  today,
  me,
  canManage,
  canAssign,
  members,
  onOpen,
  onAction,
}: {
  rows: readonly TaskListItem[]
  today: string
  me: string | null
  canManage: boolean
  canAssign: boolean
  /** Active team members, so people with nothing on still show as drop targets. */
  members: readonly DirectoryMember[]
  onOpen: (task: TaskListItem) => void
  onAction: (task: TaskListItem, action: QuickAction) => void
}) {
  const update = useUpdateTask()
  const sensors = useBoardSensors()
  const [active, setActive] = useState<DragData | null>(null)
  const columns = useMemo(() => groupByPerson(rows, today), [rows, today])
  const free = useMemo(() => {
    const busy = new Set(columns.map((c) => c.id))
    return canAssign ? members.filter((m) => !busy.has(m.user_id)) : []
  }, [columns, members, canAssign])

  function onDragStart(e: DragStartEvent) {
    setActive((e.active.data.current as DragData | undefined) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null)
    const d = e.active.data.current as DragData | undefined
    const over = e.over ? String(e.over.id) : null
    if (!d || !over?.startsWith('person:')) return
    const target = over.slice('person:'.length)
    const next = reassigned(d.task.assignee_ids, d.from, target === 'none' ? null : target)
    if (next) update.mutate({ id: d.task.id, patch: { assignees: next } })
  }

  const card = (t: TaskListItem, lifted = false) => (
    <TaskCard task={t} today={today} me={me} canManage={canManage} onOpen={onOpen} onAction={onAction} lifted={lifted} />
  )

  return (
    <DndContext sensors={sensors} collisionDetection={collide} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      {canAssign && <p className="mb-3 text-xs text-muted-foreground">Drag a card onto someone to hand it to them.</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => (
          <Column key={col.id ?? 'none'} col={col} droppable={canAssign}>
            {col.tasks.map((t) =>
              canAssign ? (
                <DraggableCard key={t.id} id={`${col.id ?? 'none'}:${t.id}`} data={{ task: t, from: col.id }}>
                  {card(t)}
                </DraggableCard>
              ) : (
                <div key={t.id}>{card(t)}</div>
              ),
            )}
          </Column>
        ))}
      </div>

      {free.length > 0 && (
        <section className="mt-4 rounded-2xl border border-dashed border-border p-3">
          <h3 className="text-sm font-semibold">Free right now</h3>
          <p className="text-xs text-muted-foreground">No open tasks. Drop a card on someone to give it to them.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {free.map((m) => (
              <FreeChip key={m.user_id} id={m.user_id} name={m.name} />
            ))}
          </div>
        </section>
      )}

      <DragOverlay dropAnimation={null}>{active && <div className="w-72">{card(active.task, true)}</div>}</DragOverlay>
    </DndContext>
  )
}

function Column({ col, droppable, children }: { col: PersonColumn; droppable: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `person:${col.id ?? 'none'}`, disabled: !droppable })
  return (
    <section
      ref={setNodeRef}
      aria-label={col.name}
      className={cn(
        'flex w-72 shrink-0 flex-col gap-2 rounded-2xl border p-2 transition-colors',
        isOver ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : col.id ? 'border-border bg-muted/40' : 'border-tone-amber/40 bg-tone-amber-soft/40',
      )}
    >
      <header className="flex items-center gap-2 px-1 py-1">
        {col.id ? (
          <Avatar name={col.name} size="sm" />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-tone-amber-soft text-tone-amber">
            <UserRound className="size-3.5" aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{col.name}</span>
        <span className="rounded-full bg-card px-2 text-xs font-medium tabular-nums">{col.tasks.length}</span>
        {col.late > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 text-xs font-semibold tabular-nums text-destructive">{col.late} late</span>
        )}
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function DraggableCard({ id, data, children }: { id: string; data: DragData; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id, data })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn('cursor-grab touch-manipulation', isDragging && 'opacity-40')}>
      {children}
    </div>
  )
}

function FreeChip({ id, name }: { id: string; name: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `person:${id}` })
  return (
    <span
      ref={setNodeRef}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-xs font-medium transition-colors',
        isOver ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-border',
      )}
    >
      <Avatar name={name} size="sm" />
      {name}
    </span>
  )
}
