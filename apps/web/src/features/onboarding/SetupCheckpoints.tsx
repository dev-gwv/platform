import { Check } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import type { Checkpoint } from './journey'

/**
 * The three setup checkpoints in a row: ✓ done, ● current, ○ still to come.
 *
 * "1 Add your team · 2 Add your first client · 3 Create your first project".
 * The same row sits at the top of every setup page and on the dashboard's
 * setup card, so wherever the owner is they can see how far along they are.
 */
export function SetupCheckpoints({ steps, className }: { steps: Checkpoint[]; className?: string }) {
  return (
    <ol className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)} aria-label="Setup steps">
      {steps.map((s) => (
        <li
          key={s.step}
          aria-current={s.state === 'current' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 text-sm',
            s.state === 'done' && 'text-success',
            s.state === 'current' && 'font-semibold text-primary',
            s.state === 'upcoming' && 'text-muted-foreground',
          )}
        >
          <Mark state={s.state} />
          <span>
            <span className="tabular-nums">{s.step}</span> {s.title}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Mark({ state }: { state: Checkpoint['state'] }) {
  if (state === 'done') {
    return (
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
        aria-label="Done"
      >
        <Check className="size-3" strokeWidth={3} aria-hidden />
      </span>
    )
  }
  if (state === 'current') {
    return (
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"
        aria-label="Current step"
      >
        <span className="size-2 rounded-full bg-primary" aria-hidden />
      </span>
    )
  }
  return (
    <span
      className="size-4 shrink-0 rounded-full border-2 border-muted-foreground/40"
      aria-label="Not started"
    />
  )
}
