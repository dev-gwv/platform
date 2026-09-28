import { useState, type CSSProperties } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Flame, MessageCircle, NotebookPen, Phone } from 'lucide-react'
import type { CrmLead } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { Avatar } from '@/shared/ui/avatar'
import { formatINR } from '@/shared/ui/format'
import { DateBadge, DueBadge, ScoreBadge, lastTouch } from './tabs/shared'
import { TagChips } from './TagChip'
import { EventTile } from '@/shared/ui/icon-tile'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { TONE_CHIP } from '@/shared/ui/tones'
import { NoteComposer } from './drawer/NotesThread'
import { prettyWord, useLookupColor } from './fields'

/**
 * A deal on the stage board.
 *
 * Laid out the way the old app lays a card out, because that shape is the
 * result of people reading a column of twenty of them every morning: a micro
 * caption for where it came from, the name, the number you would ring, the
 * money, then one footer row of small signals. Everything is left-aligned on a
 * single axis so the eye runs down the column rather than across each card.
 *
 * What is ours and stays: the shoot date with its availability verdict ("Date
 * taken", "2 asking"), which no other CRM can tell a studio, and the follow-up
 * due badge that turns red once a promise has slipped.
 *
 * The card before this carried four lines -- name, phone, owner, value -- so
 * the board could not be used to decide anything and people worked from the
 * list instead.
 */
const shootDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })

/** A number WhatsApp will accept: ten digits get the country code. */
const waNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 10 ? `91${digits}` : digits
}

export function DealCard({
  lead,
  now,
  onOpen,
  draggable,
  stageProbability,
}: {
  lead: CrmLead
  now: Date
  onOpen: (id: string) => void
  draggable: boolean
  /** Used for the bar when the deal carries no probability of its own. */
  stageProbability?: number | undefined
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    disabled: !draggable,
  })
  const style: CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  const qualityColor = useLookupColor('lead_quality')
  const [noting, setNoting] = useState(false)
  const pct = lead.probability ?? stageProbability ?? null
  const title = lead.title ?? lead.name ?? 'Unnamed deal'
  // Where it came from, as the caption above the name.
  const origin = lead.source_label ?? lead.crm_company_name ?? null
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
        'group relative rounded-md border bg-card p-3 text-left transition-shadow',
        'hover:border-primary/30 hover:shadow-sm',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40 shadow-md',
        // A hot lead earns a spine, not a tinted card: it has to be findable in
        // a column of twenty without shouting over the money.
        lead.is_hot ? 'border-l-2 border-l-destructive border-border' : 'border-border',
      )}
    >
      <button type="button" onClick={() => onOpen(lead.id)} className="block w-full text-left">
        {origin && <span className="micro-label mb-1 block truncate">{origin}</span>}

        <span className="flex items-center gap-2">
          {/* What kind of shoot, at a glance: the haldi sun, the wedding heart. */}
          {lead.event_type && <EventTile name={lead.event_type} size="sm" />}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {lead.is_hot && <Flame className="size-3.5 shrink-0 text-destructive" aria-label="Hot" />}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{title}</span>
              {lead.score > 0 && <ScoreBadge score={lead.score} />}
            </span>
          </span>
        </span>

        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{lead.phone ?? '—'}</span>

        {/* The shoot, and whether the studio is free for it. */}
        {(shoot || lead.date_status !== 'unknown') && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {shoot && <span className="truncate text-xs font-medium">{shoot}</span>}
            <DateBadge lead={lead} />
          </span>
        )}

        {lead.deal_value !== null && (
          <span className="mt-1.5 block">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold tabular-nums">{formatINR(lead.deal_value)}</span>
              {pct !== null && <span className="text-[0.65rem] tabular-nums text-muted-foreground">{pct}%</span>}
            </span>
            {pct !== null && (
              <span className="mt-1 block h-0.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-full bg-primary/70"
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </span>
            )}
          </span>
        )}

        {(lead.quality || lead.tags.length > 0) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {lead.quality && (
              <span
                className={cn(
                  'rounded-full border px-1.5 py-px text-[0.65rem] font-semibold uppercase tracking-wider',
                  TONE_CHIP[qualityColor(lead.quality) ?? 'slate'],
                )}
              >
                {prettyWord(lead.quality)}
              </span>
            )}
            {lead.tags.length > 0 && <TagChips tags={lead.tags} max={2} />}
          </span>
        )}
      </button>

      {/* One footer row of small signals: when it is due, whose it is, and how
          long since anyone actually spoke to them. */}
      <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
        <DueBadge lead={lead} now={now} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="text-[0.65rem] text-muted-foreground/80">{lastTouch(lead)}</span>
          <Avatar name={lead.assignee_name} size="sm" />
        </span>
      </div>

      {/*
        * Call and WhatsApp without opening anything.
        *
        * stopPropagation on pointerdown as well as click: the card is a drag
        * handle, and dnd-kit would otherwise take the press, so a tap would
        * start a drag instead of dialling.
        */}
      <div
        className={cn(
          'absolute right-2 top-2 flex gap-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
          noting ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Popover open={noting} onOpenChange={setNoting}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="rounded-sm border border-border bg-card p-1 text-muted-foreground hover:text-foreground"
              title="Add a note"
            >
              <NotebookPen className="size-3" />
              <span className="sr-only">Add a note for {lead.name ?? 'this lead'}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80" onPointerDown={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-semibold">{lead.name ?? 'Note'}</p>
            <NoteComposer leadId={lead.id} autoFocus onSaved={() => setNoting(false)} />
          </PopoverContent>
        </Popover>
      {lead.phone && (
        <>
          <a
            href={`tel:${lead.phone}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="rounded-sm border border-border bg-card p-1 text-muted-foreground hover:text-foreground"
            title={`Call ${lead.phone}`}
          >
            <Phone className="size-3" />
            <span className="sr-only">Call {lead.name ?? 'this lead'}</span>
          </a>
          <a
            href={`https://wa.me/${waNumber(lead.phone)}`}
            target="_blank"
            rel="noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="rounded-sm border border-border bg-card p-1 text-muted-foreground hover:text-success"
            title="WhatsApp"
          >
            <MessageCircle className="size-3" />
            <span className="sr-only">WhatsApp {lead.name ?? 'this lead'}</span>
          </a>
        </>
      )}
      </div>
    </div>
  )
}
