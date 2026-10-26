import { Plus, X } from 'lucide-react'
import type { DetailsEvent } from '@ipc/contracts'
import { EventIcon } from '@/shared/ui/icon-tile'
import { eventLabel, eventToShoot } from './from-client'

/**
 * The events the client sent on their details form (0244) that are not on
 * the Shoots tab yet. The client never changes the studio's plan; each one
 * is a tap to add.
 */
export function FromTheClient({
  events,
  busy,
  onAdd,
  onDismiss,
}: {
  events: DetailsEvent[]
  busy?: boolean
  onAdd: (shoot: ReturnType<typeof eventToShoot>) => void
  /** "Not this one": the event stops waiting here. */
  onDismiss?: ((e: DetailsEvent) => void) | undefined
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-tone-amber/60 bg-tone-amber-soft/30 px-3 py-2.5">
      <span className="text-sm font-medium text-tone-amber">From the client</span>
      {events.map((e) => (
        <span key={`${e.name}|${e.date ?? ''}`} className="inline-flex items-center rounded-full border border-border bg-card text-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdd(eventToShoot(e))}
            className="inline-flex items-center gap-1.5 rounded-l-full py-1 pl-3 pr-2 hover:bg-accent disabled:opacity-60"
          >
            <Plus className="size-3.5" aria-hidden />
            <EventIcon name={e.name} className="size-3.5" />
            {eventLabel(e)}
          </button>
          {onDismiss && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDismiss(e)}
              aria-label={`Not ${eventLabel(e)}`}
              title="Not this one"
              className="rounded-r-full border-l border-border py-1 pl-1.5 pr-2 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-60"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
