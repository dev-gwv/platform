import { CalendarClock } from 'lucide-react'
import type { TeamSlot } from '@ipc/contracts'
import { HoverPopover } from '@/shared/ui/hover-popover'
import { cn } from '@/shared/ui/cn'
import { alsoBookedText, bookingText, bookingsOn, localDay, personDay, type AvailabilityLine } from './assign'

const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

const TONE: Record<AvailabilityLine['tone'], string> = {
  green: 'border-success/40 text-success hover:bg-success/10',
  amber: 'border-warning/50 text-warning hover:bg-warning/10',
  muted: 'border-border text-muted-foreground hover:bg-muted',
}

/**
 * Someone's whole day, in the studio's words: each booking with its hours
 * and project, then when they are free. It answers the owner's question at a
 * glance -- "is this photographer booked somewhere else, and when?" -- and
 * leaves the travel time between the two to the person planning.
 */
export function PersonDayCard({
  name,
  userId,
  day,
  slots,
  highlightId,
  leave,
}: {
  name: string
  userId: string
  day: string
  slots: readonly TeamSlot[]
  /** The booking being looked at, marked "(this shoot)". */
  highlightId?: string | undefined
  leave?: 'full' | 'half' | null | undefined
}) {
  const d = personDay(userId, day, slots)
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-semibold">
        {name} <span className="font-normal text-muted-foreground">· {dayLabel(day)}</span>
      </p>
      {d.bookings.length === 0 ? (
        <p className="text-muted-foreground">Nothing booked that day.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {d.bookings.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                {bookingText(s)}
                {s.id === highlightId && <span className="text-muted-foreground"> (this shoot)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {leave && <p className="font-medium text-warning">{leave === 'half' ? 'Half-day leave' : 'On leave'}</p>}
      <p className="text-xs text-muted-foreground">
        {d.free}
        {d.hours > 0 ? ` · ${Number.isInteger(d.hours) ? d.hours : d.hours.toFixed(1)} h booked` : ''}
      </p>
    </div>
  )
}

/**
 * The one line under a name, as a small bordered chip -- a control, so it
 * looks like one -- that opens the person's day on hover or tap.
 */
export function PersonDayLine({
  line,
  className,
  ...card
}: {
  line: AvailabilityLine
  className?: string
  name: string
  userId: string
  day: string
  slots: readonly TeamSlot[]
  highlightId?: string | undefined
  leave?: 'full' | 'half' | null | undefined
}) {
  return (
    <HoverPopover content={<PersonDayCard {...card} />}>
      <button
        type="button"
        aria-label={`${card.name}'s day: ${line.text}`}
        className={cn(
          'inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          TONE[line.tone],
          className,
        )}
      >
        <span className="truncate">{line.text}</span>
      </button>
    </HoverPopover>
  )
}

/**
 * Under a booked or picked person, anywhere: their other bookings that day
 * on any project -- "Also booked 7–9 PM · Sangeet (Mehta Wedding)" -- in a
 * line that opens their whole day. Nothing when there is nothing else.
 */
export function AlsoBookedLine({
  userId,
  name,
  day,
  slots,
  ignoreSlotId,
  className,
}: {
  userId: string
  name: string
  /** The day to look at. */
  day: string
  slots: readonly TeamSlot[]
  /** The booking this line sits under: not "also", and marked in the card. */
  ignoreSlotId?: string | undefined
  className?: string
}) {
  const text = alsoBookedText(bookingsOn(userId, day, slots, { ignoreSlotId }))
  if (!text) return null
  return (
    <PersonDayLine
      line={{ tone: 'muted', text }}
      name={name}
      userId={userId}
      day={day}
      slots={slots}
      highlightId={ignoreSlotId}
      {...(className ? { className } : {})}
    />
  )
}

/** The local day a booking starts on. */
export const dayOfSlot = (s: Pick<TeamSlot, 'start_at'>) => localDay(s.start_at)
