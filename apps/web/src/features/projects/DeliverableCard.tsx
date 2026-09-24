import { useState, type ReactNode } from 'react'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  Clapperboard,
  ExternalLink,
  Film,
  HardDrive,
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
import type { Deliverable, DeliverableStatus } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useSetDeliverableStage, useUpdateDeliverable } from '@/features/projects/api'
import { useMembers } from '@/features/allocation/api'
import {
  NEXT_ACTION,
  STAGE_LABEL,
  dueLabel,
  isLate,
  nextStage,
  previousStage,
  relativeDue,
  stageOf,
  wantsLink,
} from './deliverable-stage'
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
 * The one button that moves a deliverable forward -- "Start editing",
 * "Sent to client", "Mark delivered". Sending it to the client or delivering
 * asks, in place, for the link that went out; it can be left blank.
 */
export function NextStageButton({
  id,
  status,
  link,
  size = 'sm',
}: {
  id: string
  status: string
  link: string | null | undefined
  size?: 'sm' | 'default'
}) {
  const move = useSetDeliverableStage()
  const next = nextStage(status)
  const [asking, setAsking] = useState(false)
  const [url, setUrl] = useState(link ?? '')
  if (!next) return null

  const go = (to: DeliverableStatus, delivery_link?: string | null) =>
    move.mutate({ deliverableId: id, status: to, ...(delivery_link !== undefined ? { delivery_link } : {}) }, {
      onSuccess: () => setAsking(false),
    })

  if (asking) {
    return (
      <form
        className="flex w-full items-center gap-1.5 sm:w-auto"
        onSubmit={(e) => {
          e.preventDefault()
          go(next, url.trim() || null)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          type="url"
          aria-label="Link sent to client"
          placeholder="Link sent (optional)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-8 sm:w-56"
        />
        <Button type="submit" size="sm" disabled={move.isPending}>
          {STAGE_LABEL[next]}
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
      variant={next === 'completed' ? 'default' : 'outline'}
      disabled={move.isPending}
      onClick={(e) => {
        e.stopPropagation()
        if (wantsLink(next)) setAsking(true)
        else go(next)
      }}
    >
      {NEXT_ACTION[stageOf(status)]} <ArrowRight />
    </Button>
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
export function activityText(d: Pick<Deliverable, 'last_activity_at' | 'last_activity_by' | 'last_activity_kind' | 'last_activity_body'>) {
  if (!d.last_activity_at || !d.last_activity_kind) return null
  const who = d.last_activity_by?.split(' ')[0] ?? 'Someone'
  const what =
    d.last_activity_kind === 'voice'
      ? 'sent a voice note'
      : d.last_activity_kind === 'text'
        ? 'left a note'
        : `moved it to ${STAGE_LABEL[stageOf((d.last_activity_body ?? '').replace('moved:', ''))]}`
  return `${who} ${what} · ${ago(d.last_activity_at)}`
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
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const move = useSetDeliverableStage()
  const stage = stageOf(d.status)
  const back = previousStage(d.status)
  const dropped = stage === 'cancelled'
  const late = isLate(d)
  const activity = activityText(d)

  const items: RowMenuItem[] = [
    { label: 'Open details', icon: <PanelRightOpen className="size-4" />, onSelect: onOpen },
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
        onClick={onOpen}
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

            <div className="mt-1.5">
              <StageStepper status={d.status} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5" onClick={keepControlClicks}>
              {canEdit && !dropped && stage !== 'completed' ? <EditorPicker d={d} /> : <EditorName name={d.assignee_name} />}
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
            {!dropped && <NextStageButton id={d.id} status={d.status} link={d.delivery_link} />}
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
 * Who is editing it, changed right on the card. Empty reads "Assign editor"
 * in the accent colour, so the gap is the thing you see.
 */
export function EditorPicker({ d }: { d: Deliverable }) {
  const { data: members } = useMembers()
  const update = useUpdateDeliverable(d.project_id)
  return (
    <label className="relative inline-flex items-center gap-1.5 text-xs">
      {d.assignee_name ? <Avatar name={d.assignee_name} size="sm" /> : <UserPlus className="size-3.5 text-primary" aria-hidden />}
      <select
        aria-label={`Editor for ${d.title}`}
        value={d.assignee_id ?? ''}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ deliverableId: d.id, patch: { assignee_id: e.target.value || null } })}
        className={cn(
          'cursor-pointer appearance-none rounded bg-transparent py-0.5 pr-1 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          d.assignee_name ? 'text-foreground/80' : 'text-primary',
        )}
      >
        <option value="">{d.assignee_name ? 'No editor' : 'Assign editor'}</option>
        {d.assignee_id && !(members ?? []).some((m) => m.user_id === d.assignee_id) && (
          <option value={d.assignee_id}>{d.assignee_name ?? 'Current editor'}</option>
        )}
        {(members ?? []).map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
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
        className="h-7 w-40 text-xs"
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
