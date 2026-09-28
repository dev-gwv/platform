import { useMemo, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import type { CrmLead, PipelineStage } from '@ipc/contracts'
import { REQUIRED_FIELD_LABEL, missingForStage, sortStages } from '@ipc/domain'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Select } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { useAccess } from '@/shared/auth/useAccess'
import { useActivities, useCrmPrefs, useMoveStage, usePipelines, useUpdateActivity, useUpdateCrmPrefs } from '../api'
import { taskDueBy } from '@ipc/domain'
import { Check, ClipboardList } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { LostReasonDialog } from '../LostReasonDialog'
import { DUE_COLUMNS, boardColumns, isOpen, isUncontacted, type DueBucket } from '../leads'
import { BoardColumn, DueBadge, LeadCard, LeadTable } from './shared'
import { DealCard } from '../DealCard'

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

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId || !overId.startsWith('stage-')) return
    const stage = stages.find((s) => s.id === overId.slice(6))
    const lead = leads.find((l) => l.id === activeId)
    if (!lead || !stage || lead.stage_id === stage.id) return
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
          {canEdit ? ' · drag a card to move it' : ''}
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
        <div className="flex gap-3" style={{ minWidth: stages.length * 282 }}>
          {stages.map((s) => {
            const inStage = inPipeline.filter((l) => l.stage_id === s.id)
            const value = inStage.reduce((sum, l) => sum + (l.deal_value ?? 0), 0)
            const full = s.wip_limit !== null && inStage.length >= s.wip_limit
            return (
              <DroppableStage key={s.id} stage={s} count={inStage.length} value={value} full={full}>
                {inStage.map((l) => (
                  <DealCard
                    key={l.id}
                    lead={l}
                    now={now}
                    onOpen={onOpen}
                    draggable={canEdit && !move.isPending}
                    stageProbability={s.probability_default}
                  />
                ))}
              </DroppableStage>
            )
          })}
        </div>
        </div>
      </DndContext>

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
  children,
}: {
  stage: PipelineStage
  count: number
  value: number
  full: boolean
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` })
  const gate =
    stage.required_fields.length > 0
      ? `Needs ${stage.required_fields.map((f) => REQUIRED_FIELD_LABEL[f] ?? f).join(', ')}`
      : null
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[270px] shrink-0 flex-col rounded-md border transition-colors',
        isOver
          ? full
            ? 'border-destructive bg-destructive/5'
            : 'border-primary bg-primary/5'
          : 'border-border bg-muted/40',
      )}
    >
      <div
        className="border-b-2 px-3 pb-2 pt-3"
        style={{ borderBottomColor: stageHue(stage) }}
      >
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: stageHue(stage) }} aria-hidden />
          <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider" title={stage.name}>
            {stage.name}
          </p>
          {stage.wip_limit !== null ? (
            <StatusBadge tone={full ? 'danger' : 'neutral'}>
              {full && <Lock className="mr-1 size-3" />}
              {count}/{stage.wip_limit}
            </StatusBadge>
          ) : (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
          )}
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

/**
 * A colour per stage, so the columns are tellable apart at a glance.
 *
 * The reference stores a colour on the stage. Ours does not, so this derives a
 * stable one from the stage's kind and name: won is the success tone, lost the
 * destructive one, and open stages cycle the six theme hues by name — the same
 * name always lands on the same hue, which is what makes it useful while
 * scrolling.
 */
const OPEN_HUES = [
  'var(--tone-blue)',
  'var(--tone-violet)',
  'var(--tone-teal)',
  'var(--tone-amber)',
  'var(--tone-green)',
  'var(--tone-rose)',
]
function stageHue(stage: PipelineStage): string {
  if (stage.kind === 'won') return 'var(--success)'
  if (stage.kind === 'lost') return 'var(--destructive)'
  let h = 0
  for (const ch of stage.name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return OPEN_HUES[h % OPEN_HUES.length]!
}

