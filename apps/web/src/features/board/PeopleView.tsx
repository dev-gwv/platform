import { useMemo, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'
import { Camera, ListChecks, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import type { BoardDeliverable, BoardPerson, DeliverableStage } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { humanize } from '@/shared/ui/format'
import { todayIso } from '@/features/projects/deliverable-stage'
import { BoardCard, CardFace } from './BoardCard'
import { personLoad, type PersonLoad } from './board-model'
import { useBoardReassign } from './api'
import { collide, useBoardSensors } from './StagesView'

type Sort = 'late' | 'open' | 'name'

interface Column {
  key: string
  person: BoardPerson | null
  load: PersonLoad
}

/**
 * The bird's-eye view: everyone in the studio and what they are carrying,
 * late work first. Drag a card from one person to another to hand it over;
 * the people with nothing on sit along the bottom, ready to take something.
 */
export function PeopleView({
  items,
  people,
  stages,
  canEdit,
  me,
  selected,
  onToggle,
  onOpen,
  onlyPerson,
  canSeeTasks,
}: {
  items: BoardDeliverable[]
  people: readonly BoardPerson[]
  stages: readonly DeliverableStage[]
  canEdit: boolean
  me: string | null
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  /** A person picked in the filter: show just their column. */
  onlyPerson?: string | undefined
  canSeeTasks: boolean
}) {
  const today = todayIso()
  const [sort, setSort] = useState<Sort>('late')
  const reassign = useBoardReassign()
  const sensors = useBoardSensors()
  const [active, setActive] = useState<BoardDeliverable | null>(null)

  const { columns, free } = useMemo(() => {
    const cols: Column[] = []
    const idle: BoardPerson[] = []
    for (const p of people) {
      if (onlyPerson && onlyPerson !== p.user_id) continue
      const load = personLoad(items, p.user_id, today)
      if (load.open.length > 0 || onlyPerson) cols.push({ key: p.user_id, person: p, load })
      else idle.push(p)
    }
    cols.sort((a, b) =>
      sort === 'name'
        ? a.person!.name.localeCompare(b.person!.name)
        : sort === 'open'
          ? b.load.open.length - a.load.open.length || a.person!.name.localeCompare(b.person!.name)
          : b.load.late - a.load.late || b.load.open.length - a.load.open.length || a.person!.name.localeCompare(b.person!.name),
    )
    // Work nobody is on comes first: it is the gap to fill.
    const unassigned = personLoad(items, null, today)
    if (!onlyPerson || onlyPerson === 'none') cols.unshift({ key: 'none', person: null, load: unassigned })
    return { columns: onlyPerson === 'none' ? cols.filter((c) => c.key === 'none') : cols, free: onlyPerson ? [] : idle }
  }, [items, people, sort, today, onlyPerson])

  function onDragStart(e: DragStartEvent) {
    setActive((e.active.data.current?.d as BoardDeliverable | undefined) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null)
    const d = e.active.data.current?.d as BoardDeliverable | undefined
    const over = e.over ? String(e.over.id) : null
    if (!d || !over?.startsWith('person:')) return
    const to = over.slice('person:'.length)
    const assigneeId = to === 'none' ? null : to
    if ((d.assignee_id ?? null) === assigneeId) return
    if (!canEdit) {
      toast.error('A manager hands work to someone else.')
      return
    }
    const name = assigneeId ? (people.find((p) => p.user_id === assigneeId)?.name ?? null) : null
    reassign.mutate({ id: d.id, projectId: d.project_id, assigneeId, assigneeName: name })
  }

  const cardProps = { stages, canEdit, me, showStage: true, showEditor: false }

  return (
    <DndContext sensors={sensors} collisionDetection={collide} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {canEdit ? 'Drag a card onto someone to hand it to them.' : 'Everyone and what they are working on.'}
        </p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Order
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Order people by" className="h-8 w-40 text-xs">
            <option value="late">Most late first</option>
            <option value="open">Most work first</option>
            <option value="name">By name</option>
          </Select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {columns.map((c) => (
          <PersonColumn key={c.key} column={c} canSeeTasks={canSeeTasks}>
            {c.load.open.length === 0 ? (
              <p className="px-2 py-5 text-center text-xs text-muted-foreground">
                {c.person ? 'Nothing open right now.' : 'Every deliverable has an editor.'}
              </p>
            ) : (
              c.load.open.map((d) => (
                <BoardCard key={d.id} d={d} {...cardProps} ticked={selected.has(d.id)} onToggle={() => onToggle(d.id)} onOpen={() => onOpen(d.id)} />
              ))
            )}
          </PersonColumn>
        ))}
      </div>

      {free.length > 0 && (
        <section className="mt-4 rounded-2xl border border-dashed border-border p-3">
          <h3 className="text-sm font-semibold">Free right now</h3>
          <p className="text-xs text-muted-foreground">No open deliverables.{canEdit ? ' Drop a card on someone to give it to them.' : ''}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {free.map((p) => (
              <FreeChip key={p.user_id} person={p} />
            ))}
          </div>
        </section>
      )}

      <DragOverlay dropAnimation={null}>
        {active && <CardFace d={active} {...cardProps} canMove ticked={false} onToggle={() => {}} onOpen={() => {}} lifted />}
      </DragOverlay>
    </DndContext>
  )
}

function PersonColumn({ column, canSeeTasks, children }: { column: Column; canSeeTasks: boolean; children: ReactNode }) {
  const { person, load } = column
  const { setNodeRef, isOver } = useDroppable({ id: `person:${column.key}` })
  return (
    <section
      ref={setNodeRef}
      aria-label={person ? person.name : 'Unassigned'}
      className={cn(
        'flex flex-col rounded-2xl border bg-muted/40 transition-colors',
        isOver ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : person ? 'border-border' : 'border-tone-amber/40 bg-tone-amber-soft/40',
      )}
    >
      <header className="flex items-start gap-2.5 px-3 pb-2 pt-3">
        {person ? (
          <Avatar name={person.name} />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tone-amber-soft text-tone-amber">
            <UserRound className="size-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold">{person ? person.name : 'Unassigned'}</span>
            {person?.on_shoot_today && (
              <span className="inline-flex items-center gap-1 rounded-full bg-tone-blue-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-blue">
                <Camera className="size-3" aria-hidden /> On shoot today
              </span>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground">{person ? humanize(person.role) : 'Needs an editor'}</p>
          <p className="mt-1 text-xs">
            <span className="font-semibold tabular-nums">{load.open.length}</span> open
            <span className="text-muted-foreground"> · </span>
            <span className={cn('tabular-nums', load.late > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{load.late} late</span>
            <span className="text-muted-foreground"> · </span>
            <span className="tabular-nums text-muted-foreground">{load.dueThisWeek} due this week</span>
          </p>
        </div>
      </header>
      <div className="flex max-h-[32rem] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
      {person && canSeeTasks && person.open_tasks > 0 && (
        <Link
          to="/team-work-preview"
          search={{ user: person.user_id }}
          className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-xs font-medium text-primary hover:underline"
        >
          <ListChecks className="size-3.5" aria-hidden /> and {person.open_tasks} open task{person.open_tasks === 1 ? '' : 's'}
        </Link>
      )}
    </section>
  )
}

function FreeChip({ person }: { person: BoardPerson }) {
  const { setNodeRef, isOver } = useDroppable({ id: `person:${person.user_id}` })
  return (
    <span
      ref={setNodeRef}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-xs font-medium transition-colors',
        isOver ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-border',
      )}
    >
      <Avatar name={person.name} size="sm" />
      {person.name}
      {person.on_shoot_today && <Camera className="size-3.5 text-tone-blue" aria-label="On shoot today" />}
    </span>
  )
}
