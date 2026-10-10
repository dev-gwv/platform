import { Check } from 'lucide-react'
import { cn } from './cn'

interface StepperStep<T extends string> {
  value: T
  label: string
}

/**
 * The progress rail for a multi-step flow.
 *
 * Steps you have already been through stay clickable — going back to change an
 * answer is normal, and a flow that traps you moving forward gets abandoned.
 * A step that has been visited and left in a bad state is marked, so the reason
 * a later step won't submit is visible from here rather than a step away.
 */
export function Stepper<T extends string>({
  steps,
  current,
  visited,
  invalid,
  onJump,
  className,
}: {
  steps: ReadonlyArray<StepperStep<T>>
  current: T
  /** Steps the user has already opened. Only these are navigable. */
  visited: ReadonlySet<T>
  /** Visited steps that still have a problem. */
  invalid?: ReadonlySet<T>
  onJump: (step: T) => void
  className?: string
}) {
  const currentIndex = steps.findIndex((s) => s.value === current)

  return (
    <ol className={cn('flex flex-wrap items-center gap-x-1 gap-y-2', className)}>
      {steps.map((s, i) => {
        const active = s.value === current
        const bad = invalid?.has(s.value) && !active
        const done = visited.has(s.value) && i < currentIndex && !bad
        const reachable = visited.has(s.value) && !active

        return (
          <li key={s.value} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => reachable && onJump(s.value)}
              disabled={!reachable}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-medium transition-colors',
                active && 'bg-primary text-primary-foreground',
                !active && bad && 'bg-destructive/10 text-destructive hover:bg-destructive/15',
                // A finished step reads as finished at a glance, so the one
                // that still needs you is the only thing left standing out.
                !active && !bad && done && 'bg-success/10 text-success hover:bg-success/15',
                !active && !bad && !done && reachable && 'text-foreground hover:bg-accent',
                !active && !reachable && 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  active && 'bg-primary-foreground/20 text-primary-foreground',
                  !active && bad && 'bg-destructive/20 text-destructive',
                  !active && !bad && done && 'bg-success/20 text-success',
                  !active && !bad && !done && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" /> : bad ? '!' : i + 1}
              </span>
              {s.label}
            </button>
            {i < steps.length - 1 && (
              <span aria-hidden className="hidden h-px w-6 bg-border sm:block" />
            )}
          </li>
        )
      })}
    </ol>
  )
}
