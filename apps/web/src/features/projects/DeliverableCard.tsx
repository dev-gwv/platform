import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  Clapperboard,
  ExternalLink,
  Film,
  HardDrive,
  Hourglass,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Package,
  Pencil,
  PanelRightOpen,
  Printer,
  RotateCcw,
  Trash2,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { Deliverable, DeliverableStage } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useSetDeliverableStage, useUpdateDeliverable } from '@/features/projects/api'
import { useMembers } from '@/features/allocation/api'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { STAGE_LABEL, dueLabel, isLate, previousStage, relativeDue, stageOf } from './deliverable-stage'
import { TONE_CLASSES, actionLabel, allPoints, movedLabel, nextPoint, wantsLinkAt } from './stages'
import { useDeliverableStages } from './stages-api'
import { deliverableKind, type DeliverableKind } from './deliverable-kind'
import { STAGE_STYLE, StageStepper } from './StageStepper'

export const KIND_ICON: Record<DeliverableKind, LucideIcon> = {
  album: BookOpen,
  reel: Clapperboard,
  film: Film,
  photos: ImageIcon,
  print: Printer,
  data: HardDrive,
  other: Package,
}

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
}: {
  id: string
  status: string
  code?: string | null | undefined
  link: string | null | undefined
  canEdit?: boolean
  size?: 'sm' | 'default'
}) {
  const move = useSetDeliverableStage()
  const stages = useDeliverableStages()
  const next = nextPoint({ status, custom_status_code: code }, stages)
  const [asking, setAsking] = useState(false)
  const [url, setUrl] = useState(link ?? '')
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
      { onSuccess: () => setAsking(false) },
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
          {next.label}
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
        if (wantsLinkAt(next)) setAsking(true)
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
        {allPoints(stages).map(({ step, points }) => (
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
  onOpen,
  onEdit,
  onDelete,
}: {
  d: Deliverable
  canEdit: boolean
  /** Open the panel; 'voice' opens it with the recorder already listening. */
  onOpen: (action?: 'voice') => void
  onEdit: () => void
  onDelete: () => void
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
                <EditorPicker d={d} onAssigned={setBriefFor} />
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

        {canEdit && (
          <div className="flex shrink-0 items-center justify-end gap-1" onClick={keepControlClicks}>
            {!dropped && (
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
            {!dropped && <NextStageButton id={d.id} status={d.status} code={d.custom_status_code} link={d.delivery_link} />}
            <RowMenu label={`More for ${d.title}`} items={items} />
          </div>
        )}
      </div>
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
 * Who is editing it, changed right on the card: a list of faces, editors
 * (anyone whose job role says edit) first, with a search once the team is
 * big. Empty reads "Assign editor" in the accent colour, so the gap is the
 * thing you see. `onAssigned` hears who was picked -- the card offers a voice
 * brief to them straight away.
 */
export function EditorPicker({ d, onAssigned }: { d: Deliverable; onAssigned?: (name: string) => void }) {
  const { data: members } = useMembers()
  const update = useUpdateDeliverable(d.project_id)
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  const isEditor = (roles: readonly string[]) => roles.some((r) => /edit|retouch|design|colou?r/i.test(r))
  const people = [...(members ?? [])]
    .filter((m) => !find || m.name.toLowerCase().includes(find.toLowerCase()))
    .sort((a, b) => Number(isEditor(b.role_names)) - Number(isEditor(a.role_names)) || a.name.localeCompare(b.name))

  function pick(userId: string | null, name: string | null) {
    setOpen(false)
    setFind('')
    if (userId === (d.assignee_id ?? null)) return
    update.mutate(
      { deliverableId: d.id, patch: { assignee_id: userId } },
      { onSuccess: () => userId && name && onAssigned?.(name) },
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Editor for ${d.title}`}
          disabled={update.isPending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-xs font-medium transition-colors hover:bg-muted',
            d.assignee_name ? 'text-foreground/80' : 'pl-1.5 text-primary',
          )}
        >
          {d.assignee_name ? <Avatar name={d.assignee_name} size="sm" /> : <UserPlus className="size-3.5" aria-hidden />}
          {d.assignee_name ?? 'Assign editor'}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5" onClick={(e) => e.stopPropagation()}>
        {(members?.length ?? 0) > 8 && (
          <input
            autoFocus
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find someone"
            aria-label="Find someone"
            className="mb-1 h-8 w-full rounded-full border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        <div className="max-h-72 overflow-y-auto">
          {people.map((m) => (
            <button
              key={m.user_id}
              type="button"
              onClick={() => pick(m.user_id, m.name)}
              className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted', m.user_id === d.assignee_id && 'bg-muted')}
            >
              <Avatar name={m.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.name}</span>
                {m.role_names.length > 0 && <span className="block truncate text-[11px] text-muted-foreground">{m.role_names.join(', ')}</span>}
              </span>
              {m.user_id === d.assignee_id && <Check className="size-4 text-primary" aria-hidden />}
            </button>
          ))}
          {people.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">No one by that name.</p>}
        </div>
        {d.assignee_id && (
          <button
            type="button"
            onClick={() => pick(null, null)}
            className="mt-1 w-full rounded-lg border-t border-border px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Remove the editor
          </button>
        )}
      </PopoverContent>
    </Popover>
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
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        <CalendarDays className="size-3.5" aria-hidden /> Add due date
      </button>
    )
  }
  if (stageOf(d.status) === 'completed') return <DueChip d={d} />
  return (
    <button type="button" onClick={() => setOpen(true)} className="rounded hover:underline" aria-label={`Change due date for ${d.title}`}>
      <DueChip d={d} />
    </button>
  )
}
