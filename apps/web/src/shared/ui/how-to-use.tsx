import { Lightbulb } from 'lucide-react'
import { cn } from './cn'

/**
 * The one-line explainer that sits above a module's working area: what this
 * screen is for, and the two or three moves that get someone unstuck. It reads
 * as guidance, not a warning — tinted with the accent rather than a status
 * colour, and never dismissible-looking, because it is also the map for
 * whoever inherits the studio account later.
 */
export function HowToUse({
  title,
  description,
  steps = [],
  className,
}: {
  title: string
  description: string
  steps?: readonly string[]
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-primary/15 bg-primary/[0.04] p-4 sm:p-4', className)}>
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Lightbulb className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            How to use
          </p>
          <h2 className="mt-0.5 font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>

          {steps.length > 0 && (
            <ol className="mt-3 grid gap-2 sm:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.7rem] font-semibold text-primary">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
