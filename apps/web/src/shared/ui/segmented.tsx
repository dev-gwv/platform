import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
}

/**
 * A small set of mutually exclusive views, shown all at once.
 *
 * Tabs across the top of a page say "these are sections of this screen". This
 * says "the same rows, drawn a different way" — Kanban or List — and belongs on
 * the toolbar beside the filters, not above them. It is the control the
 * reference app opens its CRM with, and at a glance it is most of why that page
 * reads as a workspace rather than a report.
 *
 * Square, not pill: it sits in a dense strip where a row of pills turns into
 * bubbles (see `shape` on Button).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (v: T) => void
  /** Names the group for screen readers, since the buttons alone are ambiguous. */
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5', className)}
    >
      {options.map((o) => {
        const on = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
              on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className="size-3" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
