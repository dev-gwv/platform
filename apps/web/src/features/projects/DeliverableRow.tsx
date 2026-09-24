import { useState } from 'react'
import { ArrowRight, CalendarDays, ExternalLink, Pencil, RotateCcw, Trash2, UserPlus, X } from 'lucide-react'
import type { Deliverable, DeliverableStatus } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useSetDeliverableStage, useUpdateDeliverable } from '@/features/projects/api'
import { useMembers } from '@/features/allocation/api'
import {
  NEXT_ACTION,
  STAGE_LABEL,
  STAGE_TONE,
  dueLabel,
  isLate,
  nextStage,
  previousStage,
  stageOf,
  wantsLink,
} from './deliverable-stage'

/**
 * The one button that moves a deliverable forward -- "Start editing",
 * "Sent to client", "Mark delivered". Sending it to the client or delivering
 * asks, in place, for the link that went out; it can be left blank.
 */
export function NextStageButton({
  id,
  status,
  link,
}: {
  id: string
  status: string
  link: string | null | undefined
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
      size="sm"
      variant="outline"
      disabled={move.isPending}
      onClick={() => (wantsLink(next) ? setAsking(true) : go(next))}
    >
      {NEXT_ACTION[stageOf(status)]} <ArrowRight />
    </Button>
  )
}

/** The due date, red once it has passed on work not yet delivered. */
export function DueChip({ d }: { d: Pick<Deliverable, 'status' | 'estimated_date' | 'delivered_at'> }) {
  const label = dueLabel(d)
  if (!label) return null
  const late = isLate(d)
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', late ? 'text-destructive' : 'text-muted-foreground')}>
      <CalendarDays className="size-3.5" aria-hidden /> {label}
    </span>
  )
}

/**
 * One deliverable on the project: what it is, who is editing it, when it is
 * due and where it stands -- with the one action that matters next, and the
 * rest in a menu. Modelled on the shoot card's person row.
 */
export function DeliverableRow({
  d,
  canEdit,
  onEdit,
  onDelete,
}: {
  d: Deliverable
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const move = useSetDeliverableStage()
  const stage = stageOf(d.status)
  const back = previousStage(d.status)
  const dropped = stage === 'cancelled'

  const items: RowMenuItem[] = [
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
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-card px-3 py-2',
        dropped && 'opacity-60',
      )}
    >
      <div className="min-w-[12rem] flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold">
          <span className={cn('min-w-0 break-words', dropped && 'line-through')}>{d.title}</span>
          {d.visibility_scope === 'internal' && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              Team only
            </span>
          )}
          {d.is_additional_charge && d.additional_charge_amount > 0 && (
            // A dropped extra is no longer charged -- say so rather than
            // leaving an amount that reads as still owed.
            <span className={cn('shrink-0 text-xs font-medium', dropped ? 'text-muted-foreground' : 'text-tone-green')}>
              {dropped ? `${formatINR(d.additional_charge_amount)} not charged` : `+${formatINR(d.additional_charge_amount)}`}
            </span>
          )}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {canEdit && !dropped ? <DueEditor d={d} /> : <DueChip d={d} />}
          {canEdit && !dropped && stage !== 'completed' ? (
            <EditorPicker d={d} />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {d.assignee_name ? (
                <>
                  <Avatar name={d.assignee_name} size="sm" /> {d.assignee_name}
                </>
              ) : (
                'No editor'
              )}
            </span>
          )}
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
        {d.description && <Brief text={d.description} />}
      </div>

      {/* On a phone the next-step button already says where it stands. */}
      <StatusBadge tone={STAGE_TONE[stage]} className={cn(canEdit && !dropped && stage !== 'completed' && 'hidden sm:inline-flex')}>
        {STAGE_LABEL[stage]}
      </StatusBadge>

      {canEdit && (
        <div className="flex items-center gap-1">
          {!dropped && <NextStageButton id={d.id} status={d.status} link={d.delivery_link} />}
          <RowMenu label={`More for ${d.title}`} items={items} />
        </div>
      )}
    </li>
  )
}

/**
 * Who is editing it, changed right on the row -- the old screen's name chip,
 * without a task in between. Empty reads "Assign editor" so the gap is the
 * thing you see.
 */
function EditorPicker({ d }: { d: Deliverable }) {
  const { data: members } = useMembers()
  const update = useUpdateDeliverable(d.project_id)
  return (
    <label className="relative inline-flex items-center gap-1 text-xs">
      {d.assignee_name ? (
        <Avatar name={d.assignee_name} size="sm" />
      ) : (
        <UserPlus className="size-3.5 text-primary" aria-hidden />
      )}
      <select
        aria-label={`Editor for ${d.title}`}
        value={d.assignee_id ?? ''}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ deliverableId: d.id, patch: { assignee_id: e.target.value || null } })}
        className={cn(
          'cursor-pointer appearance-none rounded bg-transparent py-0.5 pr-1 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          d.assignee_name ? 'text-muted-foreground' : 'text-primary',
        )}
      >
        <option value="">{d.assignee_name ? 'No editor' : 'Assign editor'}</option>
        {/* Someone not on the team list (the owner, say) still shows as themselves. */}
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
function DueEditor({ d }: { d: Deliverable }) {
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
  return (
    <button type="button" onClick={() => setOpen(true)} className="rounded hover:underline" aria-label={`Change due date for ${d.title}`}>
      <DueChip d={d} />
    </button>
  )
}

/** The editor's brief, one line until tapped. */
function Brief({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className={cn('mt-1 block w-full text-left text-xs text-muted-foreground', !open && 'line-clamp-1')}
    >
      <span className="font-medium text-foreground">Brief:</span> {text}
    </button>
  )
}
