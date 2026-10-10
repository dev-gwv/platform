import type { ReactNode } from 'react'
import { cn } from './cn'

interface RecordField {
  label: string
  value: ReactNode
  /** Pull the eye to the number that matters — a balance, a profit. */
  strong?: boolean
}

/**
 * One row of a table, as a card, for narrow screens.
 *
 * A six- or eight-column table on a phone puts nearly half of every row off
 * the side of the screen, so the amount you came to check is the part you
 * cannot see. This keeps the same data in a shape that fits, and is shared so
 * the money pages read like the ones that already do this.
 */
export function RecordCard({
  title,
  subtitle,
  badge,
  fields,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  badge?: ReactNode
  fields?: readonly RecordField[]
  actions?: ReactNode
  className?: string | undefined
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{title}</div>
          {subtitle && <div className="truncate text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>

      {fields && fields.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className={cn('truncate tabular-nums', f.strong && 'font-medium')}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/** The list wrapper, so spacing matches wherever cards replace a table. */
export function RecordCards({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>
}
