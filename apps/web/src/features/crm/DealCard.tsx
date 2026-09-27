import type { CSSProperties } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Flame, MapPin, MessageCircle, Phone } from 'lucide-react'
import type { CrmLead } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { Avatar } from '@/shared/ui/avatar'
import { formatINR } from '@/shared/ui/format'
import { DateBadge, DueBadge, ScoreBadge, lastTouch } from './tabs/shared'
import { TagChips } from './TagChip'

/**
 * A deal on the stage board.
 *
 * The card this replaces carried four lines: the name, the phone, the owner and
 * the value. Everything that makes a photography enquiry decidable — which
 * shoot, on what date, whether the studio is even free that day, when somebody
 * promised to ring back — was a click away in the drawer, so the board could not
 * be used to decide anything and people worked from the list instead.
 *
 * What is on it now, in the order the questions get asked:
 *
 *   who ....... name, and how warm they are
 *   what ...... the shoot and its date, with our own availability verdict
 *   how much .. the value, and how far through the pipeline it is
 *   when ...... the next promised call, coloured if it has slipped
 *   whose ..... the owner, and how long since anyone spoke to them
 *
 * Nothing here is new data. Every field was already on the lead and already
 * being fetched; the card simply stopped hiding it.
 */
const shootDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })

/** A phone number a studio can dial, and a WhatsApp that opens with 91 on it. */
const waNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 10 ? `91${digits}` : digits
}

export function DealCard({
  lead,
  now,
  onOpen,
  draggable,
  /** The stage's own probability, shown when the lead has none of its own. */
  stageProbability,
}: {
  lead: CrmLead
  now: Date
  onOpen: (id: string) => void
  draggable: boolean
  stageProbability?: number | undefined
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    disabled: !draggable,
  })
  const style: CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  const pct = lead.probability ?? stageProbability ?? null
  const title = lead.title ?? lead.name ?? 'Unnamed deal'
  // When the card is titled with a deal name, the person's name is the subtitle;
  // otherwise the subtitle is the thing you ring.
  const subtitle = lead.title
    ? (lead.name ?? lead.phone)
    : [lead.phone, lead.crm_company_name].filter(Boolean).join(' · ') || null
  const shoot = [lead.event_type, lead.event_date ? shootDate.format(new Date(lead.event_date)) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group relative flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-shadow',
        'hover:border-primary/30 hover:shadow-sm',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-60 shadow-md',
        // A hot lead earns a spine rather than a whole tinted card: it has to
        // stand out in a column of twenty without shouting over the value.
        lead.is_hot && 'border-l-2 border-l-destructive',
      )}
    >
      <button type="button" onClick={() => onOpen(lead.id)} className="flex flex-col gap-2 text-left">
        {/* who */}
        <div className="flex items-start gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {lead.is_hot && <Flame className="size-3.5 shrink-0 text-destructive" aria-label="Hot" />}
            <span className="truncate text-sm font-semibold tracking-tight">{title}</span>
          </span>
          {lead.score > 0 && <ScoreBadge score={lead.score} />}
        </div>
        {subtitle && <p className="-mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>}

        {/* what, and whether we are free for it */}
        {(shoot || lead.date_status !== 'unknown') && (
          <div className="flex flex-wrap items-center gap-1.5">
            {shoot && <span className="truncate text-xs font-medium">{shoot}</span>}
            <DateBadge lead={lead} />
          </div>
        )}
        {lead.event_location && (
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" aria-hidden />
            {lead.event_location}
          </p>
        )}

        {/* how much, and how far along */}
        {lead.deal_value !== null && (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-base font-semibold tabular-nums">{formatINR(lead.deal_value)}</span>
              {pct !== null && <span className="text-[0.7rem] tabular-nums text-muted-foreground">{pct}%</span>}
            </div>
            {pct !== null && (
              <span className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
              </span>
            )}
          </div>
        )}

        {/* when */}
        <DueBadge lead={lead} now={now} />

        {lead.tags.length > 0 && <TagChips tags={lead.tags} max={2} />}
      </button>

      {/* whose, and how cold it is going */}
      <div className="flex items-center gap-2 border-t border-border pt-2">
        <Avatar name={lead.assignee_name} size="sm" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {lead.assignee_name ?? 'Unassigned'}
        </span>
        <span className="shrink-0 text-[0.7rem] text-muted-foreground/80">{lastTouch(lead)}</span>
      </div>

      {/*
        * Call and WhatsApp without opening anything.
        *
        * stopPropagation on pointerdown as well as click: the card is a drag
        * handle, and dnd-kit would otherwise take the press and the tap would
        * start dragging instead of dialling.
        */}
      {lead.phone && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <a
            href={`tel:${lead.phone}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="rounded-md border border-border bg-card p-1 text-muted-foreground hover:text-foreground"
            title={`Call ${lead.phone}`}
          >
            <Phone className="size-3.5" />
            <span className="sr-only">Call {lead.name ?? 'this lead'}</span>
          </a>
          <a
            href={`https://wa.me/${waNumber(lead.phone)}`}
            target="_blank"
            rel="noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="rounded-md border border-border bg-card p-1 text-muted-foreground hover:text-success"
            title="WhatsApp"
          >
            <MessageCircle className="size-3.5" />
            <span className="sr-only">WhatsApp {lead.name ?? 'this lead'}</span>
          </a>
        </div>
      )}
    </div>
  )
}
