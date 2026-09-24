import { useState } from 'react'
import { ArrowRight, CalendarDays, ExternalLink, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import type { Deliverable, DeliverableStatus } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useSetDeliverableStage } from '@/features/projects/api'
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
          <DueChip d={d} />
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {d.assignee_name ? (
              <>
                <Avatar name={d.assignee_name} size="sm" /> {d.assignee_name}
              </>
            ) : (
              'No editor'
            )}
          </span>
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
