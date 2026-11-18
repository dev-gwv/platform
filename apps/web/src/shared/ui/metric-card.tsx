import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Card, CardContent } from './card'
import { cn } from './cn'

/**
 * The headline-figure tile: a small capitalised label, the number at the size
 * of the thing it is, and a line underneath saying what it is out of.
 *
 * Distinct from StatCard, which is a locked primitive and puts the label and
 * value at similar weight with an icon block on the right. This one is for a
 * row of four numbers read at a glance from across a desk -- the label recedes
 * into a caption, the figure carries the accent, and `hint` answers the "of
 * what?" that a bare number always raises ("of 1 added", "100% of clients
 * assigned"). `help` is the quiet definition, for a figure whose wording
 * cannot fully explain itself in three words.
 */
export function MetricCard({
  label,
  value,
  hint,
  help,
  tone = 'accent',
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  help?: string
  tone?: 'accent' | 'danger' | 'warning' | 'success' | 'muted'
  className?: string
}) {
  const toneClass = {
    accent: 'text-primary',
    danger: 'text-destructive',
    warning: 'text-warning',
    success: 'text-success',
    muted: 'text-foreground',
  }[tone]

  return (
    <Card className={className}>
      {/* Tighter on a phone, where four of these filled the first screen
          before any work showed (audit, 17 Nov). */}
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
          {help && (
            <span title={help} className="shrink-0 text-muted-foreground" aria-label={help}>
              <Info className="size-3.5" />
            </span>
          )}
        </div>
        <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums leading-none sm:mt-2 sm:text-3xl', toneClass)}>{value}</p>
        {/* A number with nothing under it is a number nobody can act on. */}
        <p className="mt-1.5 min-h-4 text-xs text-muted-foreground sm:mt-2">{hint ?? ''}</p>
      </CardContent>
    </Card>
  )
}
