import { useState } from 'react'
import { cn } from './cn'

/** "5 h", "2.5 h". */
function hoursLabelShort(hours: number): string {
  const n = Math.round(hours * 2) / 2
  return `${Number.isInteger(n) ? n : n.toFixed(1)} h`
}

const PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/**
 * How long a function runs, in hours: the twelve whole hours as one-tap
 * chips and a box for anything else (half hours, a 14-hour wedding day).
 *
 * The owner asked for it beside the start time -- "Duration (अवधि), 1 hour to
 * 12 hours, and a custom one" -- so a day's crew hours can be planned from
 * it. Like every box that needs filling it is amber until a value is in,
 * then green.
 */
export function DurationField({
  value,
  onChange,
  id,
  compact,
  'aria-invalid': ariaInvalid,
  className,
}: {
  value: number | null
  onChange: (hours: number | null) => void
  id?: string | undefined
  /** Fewer chips (1–8) for a tight row inside a dialog. */
  compact?: boolean | undefined
  'aria-invalid'?: boolean | undefined
  className?: string | undefined
}) {
  const presets = compact ? PRESETS.slice(0, 8) : PRESETS
  const isPreset = value != null && presets.includes(value)
  const [custom, setCustom] = useState(() => (value != null && !presets.includes(value) ? String(value) : ''))
  const [customOpen, setCustomOpen] = useState(() => value != null && !presets.includes(value))
  const filled = value != null && value > 0

  return (
    <div
      id={id}
      role="group"
      aria-label="Duration in hours"
      aria-invalid={ariaInvalid}
      className={cn(
        'flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors',
        filled ? 'border-success/50 bg-success/10' : 'border-warning/60 bg-warning/10',
        className,
      )}
    >
      {presets.map((h) => {
        const on = value === h
        return (
          <button
            key={h}
            type="button"
            aria-pressed={on}
            onClick={() => {
              setCustomOpen(false)
              onChange(on ? null : h)
            }}
            className={cn(
              'h-7 min-w-8 rounded-full px-2 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'bg-success text-success-foreground' : 'bg-card hover:bg-primary/10 hover:text-primary',
            )}
          >
            {h}
            {h === presets[0] || h === presets[presets.length - 1] ? ' h' : ''}
          </button>
        )
      })}
      {customOpen ? (
        <label className="flex h-7 items-center gap-1 rounded-full bg-card px-2 text-xs">
          <input
            autoFocus
            inputMode="decimal"
            aria-label="Custom hours"
            value={custom}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d.]/g, '')
              setCustom(raw)
              const n = Number(raw)
              onChange(raw !== '' && Number.isFinite(n) && n > 0 && n <= 24 ? Math.round(n * 2) / 2 : null)
            }}
            placeholder="e.g. 2.5"
            className="w-12 bg-transparent text-right tabular-nums outline-none"
          />
          <span className="text-muted-foreground">h</span>
        </label>
      ) : (
        <button
          type="button"
          aria-pressed={!isPreset && filled}
          onClick={() => {
            setCustomOpen(true)
            setCustom(value != null && !isPreset ? String(value) : '')
          }}
          className={cn(
            'h-7 rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !isPreset && filled ? 'bg-success text-success-foreground' : 'bg-card hover:bg-primary/10 hover:text-primary',
          )}
        >
          {!isPreset && filled ? hoursLabelShort(value) : 'Custom'}
        </button>
      )}
    </div>
  )
}
