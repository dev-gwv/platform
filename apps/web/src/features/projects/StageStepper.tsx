import { Check } from 'lucide-react'
import type { DeliverableStatus } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { STAGE_LABEL, STAGE_ORDER, stageOf } from './deliverable-stage'

/**
 * One colour per stage, used everywhere a stage is drawn -- the pipeline, the
 * stepper, the card's edge and icon tile -- so "blue" means Editing on every
 * screen. To do is quiet grey: nothing has happened yet.
 */
export const STAGE_STYLE: Record<DeliverableStatus, { solid: string; soft: string; text: string; border: string }> = {
  pending: { solid: 'bg-slate-400 dark:bg-slate-500', soft: 'bg-muted', text: 'text-muted-foreground', border: 'border-l-slate-300 dark:border-l-slate-600' },
  in_progress: { solid: 'bg-tone-blue', soft: 'bg-tone-blue-soft', text: 'text-tone-blue', border: 'border-l-tone-blue' },
  review: { solid: 'bg-tone-amber', soft: 'bg-tone-amber-soft', text: 'text-tone-amber', border: 'border-l-tone-amber' },
  completed: { solid: 'bg-tone-green', soft: 'bg-tone-green-soft', text: 'text-tone-green', border: 'border-l-tone-green' },
  cancelled: { solid: 'bg-muted-foreground/40', soft: 'bg-muted', text: 'text-muted-foreground', border: 'border-l-border' },
}

/**
 * Where one deliverable is on To do → Editing → With client → Delivered, as
 * four joined steps: done ones filled, the current one filled and labelled,
 * the rest empty. Readable at a glance, without reading a word.
 */
export function StageStepper({ status, size = 'sm', showLabel = true }: { status: string; size?: 'sm' | 'lg'; showLabel?: boolean }) {
  const stage = stageOf(status)
  if (stage === 'cancelled') {
    return <span className="text-xs font-medium text-muted-foreground">Dropped</span>
  }
  const at = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number])
  const style = STAGE_STYLE[stage]
  const big = size === 'lg'

  return (
    <div className={cn('flex items-center', big ? 'gap-3' : 'gap-2')} aria-label={`Stage: ${STAGE_LABEL[stage]}`}>
      <ol className="flex items-center" aria-hidden>
        {STAGE_ORDER.map((s, i) => {
          const reached = i <= at
          const current = i === at
          return (
            <li key={s} className="flex items-center">
              {i > 0 && <span className={cn(big ? 'h-0.5 w-7' : 'h-0.5 w-3.5', reached ? style.solid : 'bg-border')} />}
              <span
                title={STAGE_LABEL[s]}
                className={cn(
                  'flex items-center justify-center rounded-full transition-colors',
                  big ? 'size-5' : 'size-2.5',
                  reached ? style.solid : 'border-2 border-border bg-card',
                  current && !big && 'ring-2 ring-offset-1 ring-offset-card ring-current ' + style.text,
                  current && big && 'ring-4 ring-offset-0 ring-current/20 ' + style.text,
                )}
              >
                {big && reached && !current && <Check className="size-3 text-white" strokeWidth={3} />}
              </span>
            </li>
          )
        })}
      </ol>
      {showLabel && <span className={cn('font-semibold', big ? 'text-sm' : 'text-xs', style.text)}>{STAGE_LABEL[stage]}</span>}
    </div>
  )
}
