import { cn } from './cn'
import { shareOf, type Point } from './chart-geometry'

/**
 * Small charts, drawn as inline SVG.
 *
 * No charting library: these are bars, a line and a stacked bar, and a
 * dependency for that would cost more in bundle size than it saves in code.
 * Everything is painted with `currentColor` or a theme token, so a chart
 * follows the studio's palette and both colour schemes for free.
 */

const SHARE_TONES = [
  'bg-primary',
  'bg-primary/70',
  'bg-primary/50',
  'bg-warning',
  'bg-success',
  'bg-muted-foreground/40',
]

/** One stacked bar plus a legend — a pie chart's job without the geometry. */
export function ShareChart({
  points,
  format = (n: number) => String(n),
  className,
}: {
  points: readonly Point[]
  format?: (value: number) => string
  className?: string
}) {
  const slices = shareOf(points)
  if (slices.length === 0) return <ChartEmpty className={className} />

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {slices.map((s, i) => (
          <span
            key={s.label}
            title={`${s.label}: ${format(s.value)}`}
            style={{ width: `${s.percent}%` }}
            className={cn('h-full transition-[width] duration-500', SHARE_TONES[i % SHARE_TONES.length])}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-1.5">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span className={cn('size-2.5 shrink-0 rounded-full', SHARE_TONES[i % SHARE_TONES.length])} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="tabular-nums">{format(s.value)}</span>
            <span className="w-10 text-right tabular-nums text-muted-foreground">
              {Math.round(s.percent)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChartEmpty({ className }: { className?: string | undefined }) {
  return (
    <p className={cn('py-8 text-center text-sm text-muted-foreground', className)}>
      Not enough data to chart yet.
    </p>
  )
}
