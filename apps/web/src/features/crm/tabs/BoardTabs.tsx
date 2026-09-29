import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, EyeOff, Eye, GripVertical, Lock, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import type { CrmLead, PipelineStage } from '@ipc/contracts'
import { REQUIRED_FIELD_LABEL, missingForStage, sortStages } from '@ipc/domain'
import { TONES, TONE_BG, toneVar, type ToneName } from '@/shared/ui/tones'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Input } from '@/shared/ui/input'
import { useConfirm } from '@/shared/ui/confirm'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Select } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { useAccess } from '@/shared/auth/useAccess'
import {
  useActivities,
  useBulkPatch,
  useCreateStage,
  useCrmPrefs,
  useDeleteStage,
  useMoveStage,
  usePipelines,
  useReorderStages,
  useUpdateActivity,
  useUpdateCrmPrefs,
  useUpdateStage,
} from '../api'
import { taskDueBy } from '@ipc/domain'
import { Check, ClipboardList } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { LostReasonDialog } from '../LostReasonDialog'
import { DUE_COLUMNS, boardColumns, isOpen, isUncontacted, type DueBucket } from '../leads'
import { BoardColumn, DueBadge, LeadCard, LeadTable } from './shared'
import { DealCard } from '../DealCard'
import { LeadBulkBar } from '../LeadBulkBar'

/** Everything owed today or already late — the list to clear before going home. */
export function TodayTab({ leads, now, onOpen }: { leads: readonly CrmLead[]; now: Date; onOpen: (id: string) => void }) {
  const columns = boardColumns(leads, now)
  const due = [...columns.overdue, ...columns.today]
  const tasks = useActivities({ openTasks: true })
  const update = useUpdateActivity()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  const dueTasks = (tasks.data ?? []).filter((t) => taskDueBy(t, endOfDay))
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const open = leads.filter(isOpen)
  const uncontacted = open.filter(isUncontacted)
  const hot = open.filter((l) => l.is_hot)
  const fresh = open.filter((l) => new Date(l.created_at).getTime() >= startOfDay.getTime())

  return (
    <div className="flex flex-col gap-4">
      {dueTasks.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="flex items-center gap-2 font-medium">
            <ClipboardList className="size-4 text-muted-foreground" /> Tasks due today
          </p>
          <ul className="mt-2 divide-y divide-border">
            {dueTasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t.subject ?? 'Task'}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.lead_id ? (
                      <button type="button" className="hover:underline" onClick={() => onOpen(t.lead_id!)}>
                        {t.lead_name ?? 'Open deal'}
                      </button>
                    ) : (
                      'Contact'
                    )}
                    {t.due_at && new Date(t.due_at).getTime() < now.getTime() ? ' · overdue' : ''}
                    {t.assignee_name ? ` · ${t.assignee_name}` : ''}
                  </span>
                </span>
                {canEdit && (
                  <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: t.id, patch: { done: true } })}>
                    <Check /> Done
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {due.length === 0
          ? 'Nothing is due today and nothing is late. '
          : `${due.length} lead${due.length === 1 ? '' : 's'} to clear today — ${columns.overdue.length} already late. `}
        Work top-down; the list is ordered by how long each one has been waiting.
      </div>
      <LeadTable leads={due} now={now} total={leads.length} onOpen={onOpen} />

      {/* Chasing what is due is only half of today. These three are the ones
          that never get a follow-up date put on them in the first place, and
          so never appear on the board at all. */}
      <div className="grid gap-3 lg:grid-cols-3">
        <TodayList
          title="Uncontacted leads"
          hint="Nobody has reached them yet."
          leads={uncontacted}
          now={now}
          onOpen={onOpen}
        />
        <TodayList
          title="Hot leads"
          hint="Scored high enough to be worth a call today."
          leads={hot}
          now={now}
          onOpen={onOpen}
          tone="warning"
        />
        <TodayList
          title="Arrived today"
          hint="Came in since midnight."
          leads={fresh}
          now={now}
          onOpen={onOpen}
        />
      </div>
    </div>
  )
}

/**
 * One of the three side lists on Today's Work. Capped, because the point is
 * "here are some to pick up now", not a second copy of the inbox.
 */
function TodayList({
  title,
  hint,
  leads,
  now,
  onOpen,
  tone,
}: {
  title: string
  hint: string
  leads: readonly CrmLead[]
  now: Date
  onOpen: (id: string) => void
  tone?: 'warning'
}) {
  const shown = leads.slice(0, 6)
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        {title}
        <StatusBadge tone={tone === 'warning' && leads.length > 0 ? 'warning' : 'neutral'}>{leads.length}</StatusBadge>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      {shown.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {shown.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:underline"
                onClick={() => onOpen(l.id)}
              >
                <span className="min-w-0 truncate">{l.name ?? l.phone ?? 'Lead'}</span>
                <DueBadge lead={l} now={now} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {leads.length > shown.length && (
        <p className="mt-2 text-xs text-muted-foreground">and {leads.length - shown.length} more</p>
      )}
    </div>
  )
}

/**
 * What is owed, by when.
 *
 * `omit` drops columns the caller has already shown. Under Today -- which
 * lists overdue and due-today as a table above -- rendering those two again as
 * board columns put every late lead on the screen twice, which is the exact
 * "same leads sliced two ways" this redesign set out to remove.
 */
export function FollowUpBoardTab({
  leads,
  now,
  onOpen,
  omit = [],
}: {
  leads: readonly CrmLead[]
  now: Date
  onOpen: (id: string) => void
  omit?: readonly DueBucket[]
}) {
  const columns = boardColumns(leads, now)
  const shownColumns = DUE_COLUMNS.filter((c) => !omit.includes(c.key))
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {shownColumns.map((col) => (
        <BoardColumn
          key={col.key}
          title={col.label}
          hint={col.hint}
          count={columns[col.key].length}
          tone={col.key === 'overdue' ? 'danger' : col.key === 'today' ? 'warning' : 'neutral'}
        >
          {columns[col.key].map((l) => (
            <LeadCard key={l.id} lead={l} onOpen={onOpen} />
          ))}
        </BoardColumn>
      ))}
    </div>
  )
}

/**
 * The stage board, per pipeline. Columns are the studio's own stages; a drop
 * goes through the stage-move endpoint, which enforces each stage's WIP limit
 * and required fields, and asks for a reason before a deal is lost.
 */
export function PipelineTab({ leads, onOpen }: { leads: readonly CrmLead[]; onOpen: (id: string) => void }) {
  // One clock for the board, so a card cannot read "due today" while the one
  // beside it reads "overdue" because they asked at different moments.
  const now = useMemo(() => new Date(), [leads])
  const pipelines = usePipelines()
  const move = useMoveStage()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const [pick, setPick] = useState<string | null>(null)
  const [losing, setLosing] = useState<{ leadId: string; stageId: string } | null>(null)
  // Which pipeline this person works in is remembered; the board used to
  // snap back to the default on every visit.
  const prefs = useCrmPrefs()
  const savePrefs = useUpdateCrmPrefs()
  const bulk = useBulkPatch()
  // Ticked cards, for the bulk bar. `anchor` is the last one ticked, so a
  // shift-click can pick everything between it and the next.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [losingMany, setLosingMany] = useState<string | null>(null)

  const list = pipelines.data ?? []
  const remembered = list.find((p) => p.id === prefs.data?.pipeline_id) ?? null
  const current = list.find((p) => p.id === pick) ?? remembered ?? list.find((p) => p.is_default) ?? list[0] ?? null
  const stages = useMemo(() => (current ? sortStages(current.stages) : []), [current])
  const inPipeline = useMemo(
    () => leads.filter((l) => (current ? l.pipeline_id === current.id || (l.pipeline_id === null && current.is_default) : true)),
    [leads, current],
  )
  const total = useMemo(() => inPipeline.reduce((sum, l) => sum + (l.deal_value ?? 0), 0), [inPipeline])
  const unplaced = useMemo(
    () => inPipeline.filter((l) => !stages.some((s) => s.id === l.stage_id)),
    [inPipeline, stages],
  )

  // Only what is on screen counts: a filter that hides a ticked card un-ticks it.
  const tickedHere = useMemo(() => inPipeline.filter((l) => ticked.has(l.id)), [inPipeline, ticked])
  const clearTicks = () => {
    setTicked(new Set())
    setAnchor(null)
  }
  useEffect(() => {
    if (ticked.size === 0) return
    // Esc clears the ticks -- unless it is closing a menu or a dialog opened from the bar.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const open = document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')
      const inside = (e.target as HTMLElement | null)?.closest?.('[data-radix-popper-content-wrapper], [role="dialog"]')
      if (!open && !inside) clearTicks()
    }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [ticked.size])

  function tick(id: string, range: boolean) {
    const column = (stageId: string | null) =>
      inPipeline.filter((l) => l.stage_id === stageId).map((l) => l.id)
    const lead = inPipeline.find((l) => l.id === id)
    const from = anchor ? inPipeline.find((l) => l.id === anchor) : null
    setTicked((prev) => {
      const next = new Set(prev)
      if (range && lead && from && from.stage_id === lead.stage_id) {
        const ids = column(lead.stage_id)
        const i = ids.indexOf(from.id)
        const j = ids.indexOf(id)
        for (const x of ids.slice(Math.min(i, j), Math.max(i, j) + 1)) next.add(x)
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchor(id)
  }

  function tickColumn(stageId: string, on: boolean) {
    const ids = inPipeline.filter((l) => l.stage_id === stageId).map((l) => l.id)
    setTicked((prev) => {
      const next = new Set(prev)
      for (const x of ids) {
        if (on) next.add(x)
        else next.delete(x)
      }
      return next
    })
  }

  /** Several ticked cards dragged together move together. */
  function moveMany(ids: string[], stage: PipelineStage) {
    if (stage.kind === 'lost') {
      setLosingMany(stage.id)
      return
    }
    bulk.mutate({ ids, patch: { stage_id: stage.id } }, { onSuccess: clearTicks })
  }

  function attemptMove(lead: CrmLead, stage: PipelineStage) {
    if (stage.kind === 'lost') {
      setLosing({ leadId: lead.id, stageId: stage.id })
      return
    }
    const missing = missingForStage(stage.required_fields, lead)
    if (missing.length > 0) {
      toast.error(`Fill in ${missing.map((m) => REQUIRED_FIELD_LABEL[m] ?? m).join(', ')} before moving to ${stage.name}.`)
      return
    }
    move.mutate({ leadId: lead.id, stage_id: stage.id })
  }

  const reorder = useReorderStages()
  const visible = useMemo(
    () => stages.filter((s) => s.is_active || inPipeline.some((l) => l.stage_id === s.id)),
    [stages, inPipeline],
  )

  /** Put `id` at `to` among all the pipeline's stages and save the order. */
  function placeStage(id: string, to: number) {
    if (!current) return
    const ids = stages.map((s) => s.id).filter((x) => x !== id)
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id)
    reorder.mutate({ pipelineId: current.id, stage_ids: ids })
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId || !overId.startsWith('stage-')) return
    // A column dragged by its grip onto another column takes its place.
    if (activeId.startsWith('col-')) {
      const from = activeId.slice(4)
      const target = overId.slice(6)
      if (from !== target) placeStage(from, stages.findIndex((s) => s.id === target))
      return
    }
    const stage = stages.find((s) => s.id === overId.slice(6))
    const lead = leads.find((l) => l.id === activeId)
    if (!lead || !stage) return
    if (ticked.has(lead.id) && tickedHere.length > 1) {
      const ids = tickedHere.filter((l) => l.stage_id !== stage.id).map((l) => l.id)
      if (ids.length) moveMany(ids, stage)
      return
    }
    if (lead.stage_id === stage.id) return
    attemptMove(lead, stage)
  }

  if (pipelines.isLoading) return <SkeletonCards count={4} />
  if (pipelines.isError || !current) {
    return <ErrorState error={pipelines.error ?? new Error('No pipeline yet.')} onRetry={() => void pipelines.refetch()} />
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {list.length > 1 && (
          <Select
            value={current.id}
            onChange={(e) => {
              setPick(e.target.value)
              clearTicks()
              savePrefs.mutate({ pipeline_id: e.target.value })
            }}
            className="w-56"
            aria-label="Pipeline"
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.is_default ? ' (default)' : ''}
              </option>
            ))}
          </Select>
        )}
        <p className="text-sm text-muted-foreground">
          {inPipeline.length} deal{inPipeline.length === 1 ? '' : 's'} · {formatINR(total)} in {current.name}
          {canEdit ? ' · drag a card to move it, tick cards to change many at once' : ''}
        </p>
      </div>

      {unplaced.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="font-medium">
            {unplaced.length} deal{unplaced.length === 1 ? '' : 's'} not in a column
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            They sit in another pipeline, or have no stage yet. The totals above count them.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unplaced.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => onOpen(l.id)} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-accent">
                  {l.title ?? l.name ?? l.phone ?? 'Unnamed deal'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        {/* Horizontal, with a minimum width so the columns keep their size and
            the row scrolls rather than squashing. */}
        <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ minWidth: (visible.length + (canEdit ? 1 : 0)) * 282 }}>
          {visible.map((s) => {
            const inStage = inPipeline.filter((l) => l.stage_id === s.id)
            const value = inStage.reduce((sum, l) => sum + (l.deal_value ?? 0), 0)
            const full = s.wip_limit !== null && inStage.length >= s.wip_limit
            const tickedIn = inStage.filter((l) => ticked.has(l.id)).length
            return (
              <DroppableStage
                key={s.id}
                stage={s}
                count={inStage.length}
                value={value}
                full={full}
                tickAll={
                  canEdit && inStage.length > 0
                    ? {
                        state: tickedIn === 0 ? 'none' : tickedIn === inStage.length ? 'all' : 'some',
                        onToggle: () => tickColumn(s.id, tickedIn < inStage.length),
                      }
                    : undefined
                }
                menu={
                  canEdit ? (
                    <StageMenu
                      stage={s}
                      count={inStage.length}
                      first={stages[0]?.id === s.id}
                      last={stages[stages.length - 1]?.id === s.id}
                      onMove={(dir) => placeStage(s.id, stages.findIndex((x) => x.id === s.id) + dir)}
                    />
                  ) : null
                }
                draggableHeader={canEdit}
              >
                {inStage.map((l) => (
                  <DealCard
                    key={l.id}
                    lead={l}
                    now={now}
                    onOpen={onOpen}
                    draggable={canEdit && !move.isPending && !bulk.isPending}
                    stageProbability={s.probability_default}
                    ticked={ticked.has(l.id)}
                    ticking={ticked.size > 0}
                    onTick={canEdit ? tick : undefined}
                  />
                ))}
              </DroppableStage>
            )
          })}
          {canEdit && <AddStageColumn pipelineId={current.id} />}
        </div>
        </div>
      </DndContext>

      {tickedHere.length > 0 && <LeadBulkBar leads={tickedHere} onClear={clearTicks} />}

      <LostReasonDialog
        open={losingMany !== null}
        count={tickedHere.length}
        pending={bulk.isPending}
        onCancel={() => setLosingMany(null)}
        onConfirm={(d) => {
          if (!losingMany) return
          const ids = tickedHere.filter((l) => l.stage_id !== losingMany).map((l) => l.id)
          bulk.mutate(
            { ids, patch: { stage_id: losingMany, status: 'lost', ...d } },
            {
              onSuccess: () => {
                setLosingMany(null)
                clearTicks()
              },
            },
          )
        }}
      />

      <LostReasonDialog
        open={losing !== null}
        pending={move.isPending}
        onCancel={() => setLosing(null)}
        onConfirm={(d) => {
          if (!losing) return
          move.mutate({ leadId: losing.leadId, stage_id: losing.stageId, ...d }, { onSuccess: () => setLosing(null) })
        }}
      />
    </div>
  )
}

/**
 * One stage, as a column of a pipeline rather than a card in a grid.
 *
 * The board used to be `grid md:grid-cols-3 xl:grid-cols-6`, which wraps: six
 * stages became two rows of three, and a pipeline that wraps is not a pipeline,
 * it is a set of boxes. Fixed 270px columns in a horizontal scroller is what
 * makes the order left-to-right mean something, and it is the single biggest
 * reason the reference board reads as a workspace and ours did not.
 *
 * The 2px coloured rule under the header is the only place the stage's own
 * colour appears, which is enough to tell columns apart while scrolling without
 * tinting the whole column.
 */
function DroppableStage({
  stage,
  count,
  value,
  full,
  menu,
  draggableHeader,
  tickAll,
  children,
}: {
  stage: PipelineStage
  count: number
  value: number
  full: boolean
  menu?: ReactNode
  draggableHeader?: boolean
  /** Tick every card in this column at once. */
  tickAll?: { state: 'none' | 'some' | 'all'; onToggle: () => void } | undefined
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` })
  const drag = useDraggable({ id: `col-${stage.id}`, disabled: !draggableHeader })
  const shift = drag.transform ? { transform: `translate3d(${drag.transform.x}px, 0, 0)` } : undefined
  const gate =
    stage.required_fields.length > 0
      ? `Needs ${stage.required_fields.map((f) => REQUIRED_FIELD_LABEL[f] ?? f).join(', ')}`
      : null
  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        drag.setNodeRef(el)
      }}
      style={shift}
      className={cn(
        'flex w-[270px] shrink-0 flex-col rounded-md border transition-colors',
        drag.isDragging && 'z-20 opacity-80 shadow-lg',
        !stage.is_active && 'opacity-60',
        isOver
          ? full
            ? 'border-destructive bg-destructive/5'
            : 'border-primary bg-primary/5'
          : 'border-border bg-muted/40',
      )}
    >
      <div
        className="rounded-t-md border-b-2 px-3 pb-2 pt-3"
        style={{
          borderBottomColor: stageHue(stage),
          // The stage's colour, used boldly: a tinted header you can find
          // while scrolling, not only a thin rule.
          background: `color-mix(in oklch, ${stageHue(stage)} 12%, transparent)`,
        }}
      >
        <div className="flex items-center gap-1.5">
          {draggableHeader && (
            <button
              type="button"
              {...drag.attributes}
              {...drag.listeners}
              className="-ml-1 cursor-grab text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
              aria-label={`Drag to reorder ${stage.name}`}
            >
              <GripVertical className="size-3.5" />
            </button>
          )}
          {tickAll ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={tickAll.state === 'all' ? true : tickAll.state === 'some' ? 'mixed' : false}
              aria-label={`Select every lead in ${stage.name}`}
              title={`Select all ${count}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={tickAll.onToggle}
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                tickAll.state === 'none' ? 'border-input bg-card hover:border-primary' : 'border-primary bg-primary text-primary-foreground',
              )}
            >
              {tickAll.state === 'all' ? <Check className="size-3" strokeWidth={3} /> : tickAll.state === 'some' ? <span className="h-0.5 w-2 rounded bg-current" /> : null}
            </button>
          ) : (
            <span className="size-2 shrink-0 rounded-full" style={{ background: stageHue(stage) }} aria-hidden />
          )}
          <p
            className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider"
            style={{ color: stageHue(stage) }}
            title={stage.name}
          >
            {stage.name}
            {!stage.is_active && <span className="ml-1 normal-case text-muted-foreground">(hidden)</span>}
          </p>
          {stage.wip_limit !== null ? (
            <StatusBadge tone={full ? 'danger' : 'neutral'}>
              {full && <Lock className="mr-1 size-3" />}
              {count}/{stage.wip_limit}
            </StatusBadge>
          ) : (
            <span className="shrink-0 rounded-full bg-card/80 px-1.5 text-xs font-medium tabular-nums">{count}</span>
          )}
          {menu}
        </div>
        {/* What this column is worth, under its name -- the question a studio
            asks of a pipeline before it asks anything else. */}
        <p className="mt-0.5 text-[0.7rem] tabular-nums text-muted-foreground">
          {formatINR(value)}
          {stage.kind === 'open' ? ` · ${stage.probability_default}%` : ''}
        </p>
        {gate && (
          <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground" title={gate}>
            {gate}
          </p>
        )}
      </div>
      <div className="flex min-h-32 flex-1 flex-col gap-2 p-2">
        {count === 0 ? (
          <p
            className={cn(
              'rounded-md border-2 border-dashed py-6 text-center text-[0.7rem] transition-colors',
              isOver ? 'border-primary bg-primary/5 uppercase tracking-wider text-primary' : 'border-transparent text-muted-foreground',
            )}
          >
            {isOver ? 'Drop here' : 'Drop leads here'}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

/** The stage's own colour (0209), which the studio can change. */
function stageHue(stage: PipelineStage): string {
  return toneVar(stage.color)
}

/**
 * A stage's own menu, on its column: rename it, colour it, move it, hide it,
 * or remove it once nothing is in it. The owner's rule is that stages are
 * edited where they are seen, not on a settings page nobody finds.
 */
function StageMenu({
  stage,
  count,
  first,
  last,
  onMove,
}: {
  stage: PipelineStage
  count: number
  first: boolean
  last: boolean
  onMove: (dir: -1 | 1) => void
}) {
  const update = useUpdateStage()
  const remove = useDeleteStage()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(stage.name)
  const [renaming, setRenaming] = useState(false)

  function rename() {
    const v = name.trim()
    if (v && v !== stage.name) update.mutate({ id: stage.id, patch: { name: v } })
    setRenaming(false)
  }

  const item = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setName(stage.name)
          setRenaming(false)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="rounded-sm p-0.5 text-muted-foreground hover:bg-card hover:text-foreground" aria-label={`${stage.name} options`}>
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1.5" align="end">
        {renaming ? (
          <div className="flex gap-1.5 p-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} autoFocus className="h-8" />
            <Button size="sm" className="h-8" onClick={rename}>
              Save
            </Button>
          </div>
        ) : (
          <button type="button" className={item} onClick={() => setRenaming(true)}>
            <Pencil className="size-3.5" /> Rename
          </button>
        )}
        <div className="flex items-center gap-1.5 px-2 py-2" role="radiogroup" aria-label="Colour">
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={stage.color === t}
              aria-label={t}
              onClick={() => update.mutate({ id: stage.id, patch: { color: t } })}
              className={cn(
                'size-5 rounded-full ring-offset-2 ring-offset-card transition',
                TONE_BG[t],
                stage.color === t ? 'ring-2 ring-foreground' : 'hover:scale-110',
              )}
            />
          ))}
        </div>
        <button type="button" className={item} disabled={first} onClick={() => onMove(-1)}>
          <ArrowLeft className="size-3.5" /> Move left
        </button>
        <button type="button" className={item} disabled={last} onClick={() => onMove(1)}>
          <ArrowRight className="size-3.5" /> Move right
        </button>
        {stage.kind === 'open' && (
          <button type="button" className={item} onClick={() => update.mutate({ id: stage.id, patch: { is_active: !stage.is_active } })}>
            {stage.is_active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {stage.is_active ? 'Hide from pickers' : 'Show again'}
          </button>
        )}
        {stage.kind === 'open' && (
          <button
            type="button"
            className={cn(item, 'text-destructive')}
            disabled={count > 0}
            title={count > 0 ? 'Move the deals out first' : undefined}
            onClick={async () => {
              const ok = await confirm({ title: `Delete “${stage.name}”?`, description: 'The column goes; no deal is in it.', confirmLabel: 'Delete', destructive: true })
              if (ok) remove.mutate(stage.id)
            }}
          >
            <Trash2 className="size-3.5" /> {count > 0 ? `Delete (move ${count} out first)` : 'Delete'}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** "+ Add stage" at the end of the board: a name and a colour, and it is there, before Won and Lost. */
function AddStageColumn({ pipelineId }: { pipelineId: string }) {
  const create = useCreateStage()
  const [name, setName] = useState('')
  const [color, setColor] = useState<ToneName>('teal')
  function add() {
    const v = name.trim()
    if (!v) return
    create.mutate({ pipelineId, name: v, kind: 'open', required_fields: [], color }, { onSuccess: () => setName('') })
  }
  return (
    <div className="flex w-[240px] shrink-0 flex-col gap-2 self-start rounded-md border-2 border-dashed border-border p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Plus className="size-3.5" /> Add a stage
      </p>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder="e.g. Site visit booked"
        className={cn('h-8', name.trim() ? 'border-tone-green/60' : 'border-tone-amber/60 bg-tone-amber-soft/30')}
        aria-label="New stage name"
      />
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
        {TONES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={color === t}
            aria-label={t}
            onClick={() => setColor(t)}
            className={cn('size-4 rounded-full ring-offset-2 ring-offset-card', TONE_BG[t], color === t ? 'ring-2 ring-foreground' : '')}
          />
        ))}
      </div>
      <Button size="sm" onClick={add} disabled={!name.trim() || create.isPending}>
        Add stage
      </Button>
    </div>
  )
}
