import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { LeadFunctionInput } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { DateField } from '@/shared/ui/date-field'
import { EventTile } from '@/shared/ui/icon-tile'
import { Input } from '@/shared/ui/input'
import { EventTypeChip } from './fields'

export interface EventRow {
  event_type: string | null
  event_date: string | null
  location: string | null
}

export const EMPTY_EVENT: EventRow = { event_type: null, event_date: null, location: null }

/** A row the API will take: it has a name or a date. Blank rows are dropped. */
export const toFunctions = (rows: readonly EventRow[]): LeadFunctionInput[] =>
  rows
    .filter((r) => !!r.event_type?.trim() || !!r.event_date)
    .map((r) => ({
      event_type: r.event_type?.trim() || null,
      event_date: r.event_date || null,
      location: r.location?.trim() || null,
    }))

/**
 * Every function a couple is asking for, one row each: what it is, the day,
 * where. The owner: "they have multiple events. I should be able to select
 * that." A wedding enquiry is Haldi, Mehendi, Wedding and Reception, each on
 * its own date -- one event per lead could not hold it.
 *
 * `onCommit` is called with the whole list whenever a row is really changed
 * (a type picked, a date set, a venue left, a row removed). The drawer saves
 * then; the Add lead form keeps it until Add.
 */
export function LeadEvents({
  value,
  onCommit,
  disabled = false,
  compact = false,
}: {
  value: readonly EventRow[]
  onCommit: (rows: EventRow[]) => void
  disabled?: boolean | undefined
  compact?: boolean | undefined
}) {
  // A blank row being filled in lives here until it has something to save.
  const [rows, setRows] = useState<EventRow[]>(() => (value.length ? [...value] : [EMPTY_EVENT]))
  const incoming = JSON.stringify(value)
  useEffect(() => {
    const next: EventRow[] = JSON.parse(incoming) as EventRow[]
    setRows((cur) => {
      // Keep a blank row the person just added; take everything else from the source.
      const blanks = cur.filter((r) => !r.event_type && !r.event_date && !r.location)
      const merged = [...next, ...blanks]
      return merged.length ? merged : [EMPTY_EVENT]
    })
  }, [incoming])

  const change = (i: number, patch: Partial<EventRow>, commit: boolean) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r))
    setRows(next)
    if (commit) onCommit(next)
  }
  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i)
    setRows(next.length ? next : [EMPTY_EVENT])
    onCommit(next)
  }

  const filled = rows.filter((r) => r.event_type || r.event_date).length

  return (
    <div className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-2')}>
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2"
        >
          <EventTile name={r.event_type} size="sm" />
          <EventTypeChip value={r.event_type} onChange={(v) => change(i, { event_type: v }, true)} disabled={disabled} />
          <DateField
            aria-label={`Date of ${r.event_type ?? 'this event'}`}
            placeholder="Pick a date"
            value={r.event_date ?? ''}
            disabled={disabled}
            onChange={(e) => change(i, { event_date: e.target.value || null }, true)}
            // Amber until the date is known: the one thing a studio needs to check it is free.
            className={cn('h-8 w-36', !r.event_date && 'border-tone-amber/60 bg-tone-amber-soft/30')}
          />
          <Input
            aria-label={`Venue of ${r.event_type ?? 'this event'}`}
            placeholder="Venue"
            value={r.location ?? ''}
            disabled={disabled}
            onChange={(e) => change(i, { location: e.target.value }, false)}
            onBlur={() => onCommit(rows)}
            className="h-8 min-w-28 flex-1"
          />
          {!disabled && (rows.length > 1 || r.event_type || r.event_date || r.location) && (
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              aria-label={`Remove ${r.event_type ?? 'this event'}`}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start border-dashed"
          onClick={() => setRows((cur) => [...cur, EMPTY_EVENT])}
        >
          <Plus /> {filled === 0 ? 'Add an event' : 'Add another event'}
        </Button>
      )}
    </div>
  )
}
