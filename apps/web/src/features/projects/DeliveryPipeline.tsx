import type { Deliverable, DeliverableStatus } from '@ipc/contracts'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { STAGE_LABEL, STAGE_ORDER, daysToDue, deliverableCounts, isLate, relativeDue, stageOf } from './deliverable-stage'
import { STAGE_STYLE } from './StageStepper'

export type PipelineFilter = (typeof STAGE_ORDER)[number] | 'late' | null

/**
 * Where the project's delivery stands, in one strip: how many things are at
 * each stage, how far along the whole is, what is due next and what is late.
 *
 * On the Deliverables tab each stage is a filter (tap again to clear); on the
 * Overview it is the same picture, read-only, so both screens look alike.
 */
export function DeliveryPipeline({
  deliverables,
  filter,
  onFilter,
  compact = false,
}: {
  deliverables: readonly Deliverable[]
  filter?: PipelineFilter
  onFilter?: (f: PipelineFilter) => void
  compact?: boolean
}) {
  const counts = deliverableCounts(deliverables)
  const live = deliverables.filter((d) => stageOf(d.status) !== 'cancelled')
  const byStage = (s: DeliverableStatus) => live.filter((d) => stageOf(d.status) === s).length
  const pct = counts.total ? Math.round((counts.delivered / counts.total) * 100) : 0

  const next = live
    .map((d) => ({ d, days: daysToDue(d) }))
    .filter((x): x is { d: Deliverable; days: number } => x.days !== null && x.days >= 0)
    .sort((a, b) => a.days - b.days)[0]?.d

  const interactive = !!onFilter
  const toggle = (f: PipelineFilter) => onFilter?.(filter === f ? null : f)

  return (
    <div className={cn('rounded-xl border border-border bg-card', compact ? 'p-3' : 'p-4')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STAGE_ORDER.map((s) => {
          const n = byStage(s)
          const on = filter === s
          const style = STAGE_STYLE[s]
          const Tag = interactive ? 'button' : 'div'
          return (
            <Tag
              key={s}
              {...(interactive ? { type: 'button' as const, onClick: () => toggle(s), 'aria-pressed': on } : {})}
              className={cn(
                'group relative flex flex-col items-start overflow-hidden rounded-lg border px-3 py-2 text-left transition-all',
                on ? 'border-transparent ring-2 ring-current ' + style.text : 'border-border',
                interactive && 'hover:border-foreground/20 hover:shadow-sm',
                n === 0 && !on && 'opacity-60',
              )}
            >
              <span className={cn('absolute inset-x-0 top-0 h-1', style.solid)} aria-hidden />
              <span className={cn('mt-1 text-2xl font-semibold tabular-nums leading-none', n > 0 ? 'text-foreground' : 'text-muted-foreground')}>{n}</span>
              <span className={cn('mt-1 text-xs font-medium', style.text)}>{STAGE_LABEL[s]}</span>
            </Tag>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[12rem] flex-1 items-center gap-2">
          <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct}% delivered`}>
            {STAGE_ORDER.map((s) => {
              const n = byStage(s)
              return n > 0 ? <span key={s} className={STAGE_STYLE[s].solid} style={{ width: `${(n / Math.max(1, counts.total)) * 100}%` }} /> : null
            })}
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {counts.delivered} of {counts.total} delivered
          </span>
        </div>

        {next && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" aria-hidden />
            Next: <span className="font-medium text-foreground">{next.title}</span> · {relativeDue(next)?.toLowerCase()}
          </span>
        )}

        {counts.late > 0 &&
          (interactive ? (
            <button
              type="button"
              onClick={() => toggle('late')}
              aria-pressed={filter === 'late'}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
                filter === 'late' ? 'bg-destructive text-destructive-foreground' : 'bg-destructive/10 text-destructive hover:bg-destructive/15',
              )}
            >
              <AlertTriangle className="size-3.5" aria-hidden /> {counts.late} late
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
              <AlertTriangle className="size-3.5" aria-hidden /> {counts.late} late: {live.filter((d) => isLate(d)).map((d) => d.title).join(', ')}
            </span>
          ))}
      </div>
    </div>
  )
}
