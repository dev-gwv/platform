import type { ShootListItem } from '@ipc/contracts'
import { Input, Label } from '@/shared/ui/input'
import { DurationField } from '@/shared/ui/duration-field'
import { cn } from '@/shared/ui/cn'
import { defaultWindowFields, windowOf, type BaseWindow } from './assign'

export type WhenFields = BaseWindow

/** The day, start and hours a shoot has, as the three fields. */
export function whenOfShoot(shoot: Pick<ShootListItem, 'shoot_date' | 'start_at' | 'end_at'>): WhenFields {
  const d = defaultWindowFields(shoot)
  // A shoot with no start yet offers 9am as a suggestion, but the field
  // starts blank so nothing is saved that nobody chose.
  return shoot.start_at ? d : { date: d.date, time: '', hours: null }
}

/** What to save: the day, the instant it starts, and the instant it ends (start + hours). */
export function whenToPatch(w: WhenFields): { shoot_date: string | null; start_at: string | null; end_at: string | null } {
  const start = w.date && /^\d{2}:\d{2}/.test(w.time) ? new Date(`${w.date}T${w.time.slice(0, 5)}:00`) : null
  const window = w.hours != null ? windowOf(w.date, w.time, w.hours) : null
  return {
    shoot_date: w.date || null,
    start_at: start && !Number.isNaN(start.getTime()) ? start.toISOString() : null,
    end_at: window?.end ?? null,
  }
}

/**
 * Date · Start time · Duration (अवधि): the one way a shoot's hours are set,
 * in the project wizard, the edit dialog and the assign dialog alike. Two
 * boxes and a row of hour chips, never two datetime pickers.
 */
export function ShootWhenFields({
  value,
  onChange,
  idPrefix = 'when',
  compact,
  className,
}: {
  value: WhenFields
  onChange: (next: WhenFields) => void
  idPrefix?: string
  /** Fewer chips, for a strip inside a dialog. */
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]', className)}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-date`}>Date</Label>
        <Input id={`${idPrefix}-date`} type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-time`}>Start time</Label>
        <Input
          id={`${idPrefix}-time`}
          type="time"
          value={value.time}
          onChange={(e) => onChange({ ...value, time: e.target.value })}
          aria-invalid={!value.time}
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-hours`}>Duration (अवधि)</Label>
        <DurationField
          id={`${idPrefix}-hours`}
          value={value.hours}
          onChange={(hours) => onChange({ ...value, hours })}
          compact={compact}
          aria-invalid={value.hours == null}
        />
      </div>
    </div>
  )
}
