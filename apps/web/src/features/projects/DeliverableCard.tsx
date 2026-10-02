import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  CalendarDays,
  Check,
  ExternalLink,
  Hourglass,
  MessageSquare,
  Mic,
  Pencil,
  PanelRightOpen,
  RotateCcw,
  Trash2,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { Deliverable, DeliverableStage, TeamMember } from '@ipc/contracts'
import { AssignedNote } from '@/features/team/AssignedNote'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useSetDeliverableStage, useUpdateDeliverable } from '@/features/projects/api'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { RemindMe } from '@/features/reminders/RemindMe'
import { STAGE_LABEL, dueLabel, fromLabel, isLate, previousStage, relativeDue, stageOf } from './deliverable-stage'
import { TONE_CLASSES, actionLabel, allPoints, movedLabel, nextPoint, wantsLinkAt } from './stages'
import { useDeliverableStages, useDeliveryFlow } from './stages-api'
import { deliverableKind, type DeliverableKind } from './deliverable-kind'
import { DELIVERABLE_ICON } from '@/shared/ui/icon-tile'
import { STAGE_STYLE, StageStepper } from './StageStepper'
import { GiveWorkDialog } from './GiveWorkDialog'

export const KIND_ICON: Record<DeliverableKind, LucideIcon> = DELIVERABLE_ICON

/** The item's picture: its kind, in its stage's colour; a check once delivered. */
export function KindTile({ title, status, size = 'md' }: { title: string; status: string; size?: 'md' | 'lg' }) {
  const stage = stageOf(status)
  const Icon = stage === 'completed' ? Check : KIND_ICON[deliverableKind(title)]
  const style = STAGE_STYLE[stage]
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl',
        size === 'lg' ? 'size-12' : 'size-10',
        stage === 'completed' ? 'bg-tone-green text-white' : cn(style.soft, style.text),
      )}
      aria-hidden
    >
      <Icon className={size === 'lg' ? 'size-6' : 'size-5'} strokeWidth={stage === 'completed' ? 3 : 2} />
    </span>
  )
}

/**
 * The one button that moves a deliverable forward, one stop at a time --
 * "Start editing", "Send for review", "Approve", "Sent to client", "Mark
 * delivered" -- through the studio's own stages. When work goes out it asks,
 * in place, for the link that went with it; that can be left blank.
 *
 * An editor sees it only where the next stop is theirs to make; where a
 * manager has to approve, they see that it is waiting.
 */
export function NextStageButton({
  id,
  status,
  code,
  link,
  canEdit = true,
  size = 'sm',
  assigneeId,
  onNeedEditor,
}: {
  id: string
  status: string
  code?: string | null | undefined
  link: string | null | undefined
  canEdit?: boolean
  size?: 'sm' | 'default'
  /** Who is on it; with `onNeedEditor`, Start editing with nobody on it asks who. */
  assigneeId?: string | null | undefined
  onNeedEditor?: () => void
}) {
  const move = useSetDeliverableStage()
  const stages = useDeliverableStages()
  const flow = useDeliveryFlow()
  const next = nextPoint({ status, custom_status_code: code }, stages, flow)
  const [asking, setAsking] = useState(false)
  const [url, setUrl] = useState(link ?? '')
  // A pasted link survives a refresh or a closed tab until the stage moves.
  const draft = useFormDraft(asking ? `deliverable-link:${id}` : null, { url }, (v) => setUrl(v.url))
  if (!next) return null
  if (!canEdit && !next.team_allowed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        <Hourglass className="size-3.5" aria-hidden /> Waiting for review
      </span>
    )
  }

  const go = (delivery_link?: string | null) =>
    move.mutate(
      {
        deliverableId: id,
        status: next.status,
        custom_status_code: next.code,
        ...(delivery_link !== undefined ? { delivery_link } : {}),
      },
      {
        onSuccess: () => {
          draft.clear()
          setAsking(false)
        },
      },
    )

  if (asking) {
    return (
      <form
        className="flex w-full items-center gap-1.5 sm:w-auto"
        onSubmit={(e) => {
          e.preventDefault()
          go(url.trim() || null)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          type="url"
          aria-label="Link sent to client"
          placeholder="Link to the work (optional)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-8 sm:w-56"
        />
        <Button type="submit" size="sm" disabled={move.isPending}>
          {actionLabel(next)}
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setAsking(false)} aria-label="Cancel">
          <X />
        </Button>
      </form>
    )
  }

  return (
    <Button
      size={size}
      variant={next.status === 'completed' ? 'default' : 'outline'}
      disabled={move.isPending}
      onClick={(e) => {
        e.stopPropagation()
        // Starting the edit with nobody on it: ask who edits it first.
        if (onNeedEditor && !assigneeId && next.status === 'in_progress' && stageOf(status) === 'pending') onNeedEditor()
        else if (wantsLinkAt(next)) setAsking(true)
        else go()
      }}
    >
      {actionLabel(next)} <ArrowRight />
    </Button>
  )
}

/**
 * "Move to…": every stage the studio has, grouped by step, each in its own
 * colour, the current one ticked. The trigger is whatever is passed in --
 * on the card it is the stage itself. An editor can pick only the stages
 * the studio lets the team use.
 */
export function MoveToMenu({
  d,
  canEdit,
  children,
}: {
  d: Pick<Deliverable, 'id' | 'status' | 'custom_status_code'> & { title?: string }
  canEdit: boolean
  children: ReactNode
}) {
  const move = useSetDeliverableStage()
  const stages = useDeliverableStages()
  const flow = useDeliveryFlow()
  const [open, setOpen] = useState(false)
  const current = stageOf(d.status)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="-mx-1 rounded-full px-1 py-0.5 transition-colors hover:bg-muted"
          aria-label={`Change the stage of ${d.title ?? 'this deliverable'}`}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5" onClick={(e) => e.stopPropagation()}>
        <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Move to</p>
        {allPoints(stages, flow).map(({ step, points }) => (
          <div key={step} className="border-t border-border py-1 first:border-t-0">
            {points.map((p) => {
              const here = current === p.status && (d.custom_status_code ?? null) === p.code
              const allowed = canEdit || p.team_allowed
              const tone = TONE_CLASSES[p.tone]
              return (
                <button
                  key={`${p.status}:${p.code ?? ''}`}
                  type="button"
                  disabled={!allowed || move.isPending}
                  onClick={() => {
                    setOpen(false)
                    if (!here) move.mutate({ deliverableId: d.id, status: p.status, custom_status_code: p.code })
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40',
                    p.code ? 'pl-6' : 'pl-2 font-semibold',
                    here && 'bg-muted',
                  )}
                >
                  <span className={cn('size-2.5 shrink-0 rounded-full', tone.solid)} aria-hidden />
                  <span className="flex-1 truncate">{p.label}</span>
                  {here && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** The due date, red once it has passed on work not yet delivered. */
export function DueChip({ d }: { d: Pick<Deliverable, 'status' | 'estimated_date' | 'delivered_at'> }) {
  const label = relativeDue(d)
  if (!label) return null
  const late = isLate(d)
  return (
    <span
      title={dueLabel(d) ?? undefined}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        late ? 'text-destructive' : stageOf(d.status) === 'completed' ? 'text-tone-green' : 'text-muted-foreground',
      )}
    >
      <CalendarDays className="size-3.5" aria-hidden /> {label}
    </span>
  )
}

/** Clicks on a control stay with the control; anywhere else opens the card. */
const keepControlClicks = (e: { target: EventTarget; stopPropagation: () => void }) => {
  if ((e.target as HTMLElement).closest('button, a, select, input, label, form')) e.stopPropagation()
}

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.round(hrs / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** "Sana sent a voice note · yesterday" -- the latest thing that happened on it. */
export function activityText(
  d: Pick<Deliverable, 'last_activity_at' | 'last_activity_by' | 'last_activity_kind' | 'last_activity_body'>,
  stages: readonly DeliverableStage[] = [],
) {
  if (!d.last_activity_at || !d.last_activity_kind) return null
  const who = d.last_activity_by?.split(' ')[0] ?? 'Someone'
  return `${who} ${activityWhat(d.last_activity_kind, d.last_activity_body, stages)} · ${ago(d.last_activity_at)}`
}

/** What an event in the timeline says happened, after the person's name. */
export function activityWhat(kind: string, body: string | null | undefined, stages: readonly DeliverableStage[]): string {
  if (kind === 'voice') return 'sent a voice note'
  if (kind === 'text') return 'left a note'
  const tag = (body ?? '').split(':')[0]
  switch (tag) {
    case 'submitted':
      return 'submitted work for review'
    case 'resubmitted':
      return 'submitted a new version'
    case 'approved':
      return 'approved the work'
    case 'sent_back':
      return 'sent it back for changes'
    case 'sent_to_client':
      return 'sent it to the client'
    default:
      return `moved it to ${movedLabel(body, stages)}`
  }
}

/**
 * One deliverable, as a card you can read in a second: what it is (icon and
 * title), where it stands (the stepper and the coloured edge), who is on it
 * and when it is due, what last happened -- and the one button that moves it
 * on. Tap anywhere else on it for the whole story, notes and voice notes.
 */
export function DeliverableCard({
  d,
  canEdit,
  projectName,
  onOpen,
  onEdit,
  onDelete,
  selected,
  onToggleSelect,
}: {
  d: Deliverable
  canEdit: boolean
  /** Said in a reminder set from here, so "Photo Album" is not just any album. */
  projectName?: string | undefined
  /** Open the panel; 'voice' opens it with the recorder already listening. */
  onOpen: (action?: 'voice') => void
  onEdit: () => void
  onDelete: () => void
  /** Ticked for the bulk bar; the box shows only when this is given. */
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const move = useSetDeliverableStage()
  const stages = useDeliverableStages()
  const stage = stageOf(d.status)
  const back = previousStage(d.status)
  const dropped = stage === 'cancelled'
  const late = isLate(d)
  const activity = activityText(d, stages)
  // Just gave it to someone: offer them a voice brief, for a few seconds.
  const [briefFor, setBriefFor] = useState<string | null>(null)
  // ...and, for a studio's first few assignments, that they see it on their own login.
  const [noteFor, setNoteFor] = useState<TeamMember | null>(null)
  // "Who will edit it?", from Start editing or the editor chip.
  const [giving, setGiving] = useState(false)
  const given = (m: TeamMember) => {
    setBriefFor(m.name)
    setNoteFor(m)
  }
  useEffect(() => {
    if (!briefFor) return
    const t = window.setTimeout(() => setBriefFor(null), 10_000)
    return () => window.clearTimeout(t)
  }, [briefFor])

  const items: RowMenuItem[] = [
    { label: 'Open details', icon: <PanelRightOpen className="size-4" />, onSelect: () => onOpen() },
    { label: 'Send a voice note', icon: <Mic className="size-4" />, onSelect: () => onOpen('voice') },
    { label: 'Edit…', icon: <Pencil className="size-4" />, onSelect: onEdit },
    ...(back && !dropped
      ? [{ label: `Back to ${STAGE_LABEL[back]}`, icon: <RotateCcw className="size-4" />, onSelect: () => move.mutate({ deliverableId: d.id, status: back }) }]
      : []),
    dropped
      ? { label: 'Restore', onSelect: () => move.mutate({ deliverableId: d.id, status: 'pending' }) }
      : { label: 'Client no longer wants it', onSelect: () => move.mutate({ deliverableId: d.id, status: 'cancelled' }) },
    { label: 'Delete', icon: <Trash2 className="size-4" />, onSelect: onDelete },
  ]

  return (
    <li
      className={cn(
        'group relative rounded-xl border border-l-4 border-border bg-card shadow-sm transition-shadow hover:shadow-md',
        late ? 'border-l-destructive' : STAGE_STYLE[stage].border,
        dropped && 'opacity-60',
      )}
    >
      {/* The whole card opens the details; the controls inside stop the click. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onOpen())}
        aria-label={`Open ${d.title}`}
        className="flex cursor-pointer flex-col gap-3 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:p-4"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Tick ${d.title}`}
              className="mt-3 size-4 shrink-0 cursor-pointer accent-primary"
            />
          )}
          <KindTile title={d.title} status={d.status} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={cn('min-w-0 break-words text-[15px] font-semibold leading-tight', dropped && 'line-through')}>{d.title}</span>
              {d.visibility_scope === 'internal' && (
                <span className="shrink-0 rounded-full bg-tone-violet-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-tone-violet">
                  Team only
                </span>
              )}
              {d.is_additional_charge && d.additional_charge_amount > 0 && (
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', dropped ? 'bg-muted text-muted-foreground' : 'bg-tone-green-soft text-tone-green')}>
                  {dropped ? `${formatINR(d.additional_charge_amount)} not charged` : `+${formatINR(d.additional_charge_amount)}`}
                </span>
              )}
            </p>
            {(d.shoot_names?.length ?? 0) > 1 && <p className="mt-0.5 text-xs text-muted-foreground">From {fromLabel(d)}</p>}

            <div className="mt-1.5" onClick={keepControlClicks}>
              {canEdit && !dropped ? (
                <MoveToMenu d={d} canEdit={canEdit}>
                  <StageStepper status={d.status} code={d.custom_status_code} />
                </MoveToMenu>
              ) : (
                <StageStepper status={d.status} code={d.custom_status_code} />
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5" onClick={keepControlClicks}>
              {canEdit && !dropped && stage !== 'completed' ? (
                <EditorChip d={d} onOpen={() => setGiving(true)} />
              ) : (
                <EditorName name={d.assignee_name} />
              )}
              {briefFor && (
                <button
                  type="button"
                  onClick={() => {
                    setBriefFor(null)
                    onOpen('voice')
                  }}
                  className="ipc-menu inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  <Mic className="size-3.5" aria-hidden /> Send {briefFor.split(' ')[0]} a voice brief
                </button>
              )}
              {canEdit && !dropped ? <DueEditor d={d} /> : <DueChip d={d} />}
              {d.delivery_link && (
                <a
                  href={d.delivery_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden /> Open link
                </a>
              )}
            </div>
            {noteFor && <AssignedNote members={[noteFor]} onClose={() => setNoteFor(null)} className="mt-2" />}

            {(d.description || activity || d.notes_count > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {d.description && (
                  <span className="line-clamp-1 max-w-full">
                    <span className="font-medium text-foreground">Brief:</span> {d.description}
                  </span>
                )}
                {activity && <span>{activity}</span>}
                {d.voice_count > 0 && (
                  <Count icon={<Mic className="size-3.5" aria-hidden />} n={d.voice_count} label="voice note" />
                )}
                {d.notes_count - d.voice_count > 0 && (
                  <Count icon={<MessageSquare className="size-3.5" aria-hidden />} n={d.notes_count - d.voice_count} label="note" />
                )}
              </div>
            )}
          </div>
        </div>

        {(canEdit || !dropped) && (
          <div className="flex shrink-0 items-center justify-end gap-1" onClick={keepControlClicks}>
            {/* Anyone looking at it can ask to be reminded; the rest is the editor's. */}
            {!dropped && <RemindMe entityType="deliverable" entityId={d.id} name={d.title} context={projectName} />}
            {canEdit && !dropped && (
              <button
                type="button"
                onClick={() => onOpen('voice')}
                aria-label={`Send ${d.assignee_name ?? 'a'} voice note`}
                title="Record a voice note"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/5 px-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
              >
                <span className="size-2 rounded-full bg-destructive" aria-hidden />
                <Mic className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Voice note</span>
              </button>
            )}
            {canEdit && !dropped && (
              <NextStageButton
                id={d.id}
                status={d.status}
                code={d.custom_status_code}
                link={d.delivery_link}
                assigneeId={d.assignee_id}
                onNeedEditor={() => setGiving(true)}
              />
            )}
            {canEdit && <RowMenu label={`More for ${d.title}`} items={items} />}
          </div>
        )}
      </div>
      {giving && <GiveWorkDialog deliverables={[d]} onClose={() => setGiving(false)} onGiven={given} />}
    </li>
  )
}

function Count({ icon, n, label }: { icon: ReactNode; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/80" title={`${n} ${label}${n === 1 ? '' : 's'}`}>
      {icon} {n}
    </span>
  )
}

export function EditorName({ name }: { name: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {name ? (
        <>
          <Avatar name={name} size="sm" /> {name}
        </>
      ) : (
        'No editor'
      )}
    </span>
  )
}

/**
 * Who is editing it, as a chip you can see is a control: their face and name,
 * or an amber dashed "Assign editor" while nobody is on it. It opens "Who will
 * edit it?" -- the same dialog Start editing opens.
 */
export function EditorChip({ d, onOpen }: { d: Deliverable; onOpen: () => void }) {
  const needs = !d.assignee_name && (stageOf(d.status) === 'pending' || stageOf(d.status) === 'in_progress')
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Editor for ${d.title}`}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors',
        d.assignee_name
          ? 'border-border bg-card text-foreground/85 hover:bg-muted'
          : needs
            ? 'border-dashed border-warning/70 bg-warning/10 text-warning hover:bg-warning/15'
            : 'border-border bg-card text-primary hover:bg-muted',
      )}
    >
      {d.assignee_name ? <Avatar name={d.assignee_name} size="sm" /> : <UserPlus className="size-3.5" aria-hidden />}
      {d.assignee_name ?? 'Assign editor'}
    </button>
  )
}

/** The editor chip with its own "Who will edit it?" -- for the drawer. */
export function EditorPicker({ d, onAssigned }: { d: Deliverable; onAssigned?: (member: TeamMember) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <EditorChip d={d} onOpen={() => setOpen(true)} />
      {open && <GiveWorkDialog deliverables={[d]} onClose={() => setOpen(false)} {...(onAssigned ? { onGiven: onAssigned } : {})} />}
    </>
  )
}

/** The due chip, which becomes a date field when tapped; "Add due date" when there is none. */
export function DueEditor({ d }: { d: Deliverable }) {
  const update = useUpdateDeliverable(d.project_id)
  const [open, setOpen] = useState(false)
  if (open) {
    return (
      <Input
        type="date"
        autoFocus
        aria-label={`Due date for ${d.title}`}
        defaultValue={d.estimated_date ?? ''}
        className="h-7 w-auto text-xs"
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        onChange={(e) => {
          update.mutate({ deliverableId: d.id, patch: { estimated_date: e.target.value || null } })
          setOpen(false)
        }}
      />
    )
  }
  if (!d.estimated_date && stageOf(d.status) !== 'completed') {
    // Work with an editor and no date is the gap to fill: amber until set.
    const needs = !!d.assignee_id || stageOf(d.status) === 'in_progress'
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
          needs ? 'border-dashed border-warning/70 bg-warning/10 text-warning hover:bg-warning/15' : 'border-border bg-card text-primary hover:bg-muted',
        )}
      >
        <CalendarDays className="size-3.5" aria-hidden /> Add due date
      </button>
    )
  }
  if (stageOf(d.status) === 'completed') return <DueChip d={d} />
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex h-7 items-center rounded-full border border-border bg-card px-2.5 hover:bg-muted"
      aria-label={`Change due date for ${d.title}`}
    >
      <DueChip d={d} />
    </button>
  )
}
