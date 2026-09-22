import { Link } from '@tanstack/react-router'
import {
  Sparkles,
  Users,
  UserPlus,
  FolderPlus,
  CalendarDays,
  Database,
  IndianRupee,
  Activity,
  ArrowRight,
  Check,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import type { JourneyStep, JourneyStepKey } from './journey'

const ICONS: Record<JourneyStepKey, LucideIcon> = {
  team: Users,
  client: UserPlus,
  project: FolderPlus,
  booking: CalendarDays,
  data: Database,
  payment: IndianRupee,
  tracking: Activity,
}

interface Props {
  steps: JourneyStep[]
  completed: number
  total: number
}

/**
 * The setup checklist a new studio sees on its dashboard.
 *
 * Only the current step is expanded. The card promises to guide someone
 * "one at a time", so showing seven equally-weighted rows — each with its own
 * button — contradicted the copy and left no single obvious thing to do. The
 * rest collapse to one line each, which also keeps the real dashboard above
 * the fold.
 *
 * It is a guide, not a gate: every collapsed row is still a link, so nobody
 * who knows where they are going gets held up.
 */
export function SetupJourney({ steps, completed, total }: Props) {
  return (
    <Card className="mb-6 overflow-hidden">
      <CardContent className="p-4 sm:p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Studio Setup Journey</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Follow these steps to set up your studio. We'll guide you through one at a time.
              </p>
            </div>
          </div>

          <div className="sm:min-w-44">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
                Progress
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {completed} of {total}
              </p>
            </div>
            {/* A segment per step rather than one filled bar: at zero complete a
                bar is an empty trough that reads as a broken element, while the
                segments still show where you are. */}
            <div
              className="mt-2 flex gap-1"
              role="progressbar"
              aria-valuenow={completed}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label="Studio setup progress"
            >
              {steps.map((s) => (
                <span
                  key={s.key}
                  className={cn(
                    'h-1.5 flex-1 rounded-full transition-colors duration-500',
                    s.state === 'done'
                      ? 'bg-success'
                      : s.state === 'current'
                        ? 'bg-primary'
                        : 'bg-muted',
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        <ol className="mt-4 flex flex-col gap-1.5">
          {steps.map((step) =>
            step.state === 'current' ? (
              <CurrentStep key={step.key} step={step} />
            ) : (
              <CompactStep key={step.key} step={step} />
            ),
          )}
        </ol>
      </CardContent>
    </Card>
  )
}

/** The one step being asked for: the only row with a description and a button. */
function CurrentStep({ step }: { step: JourneyStep }) {
  const Icon = ICONS[step.key]

  return (
    <li
      className="rounded-lg border border-primary/40 bg-primary/[0.04] p-3.5 ring-1 ring-primary/20 sm:p-4"
      aria-label={`Step ${step.step} — ${step.title}, current step`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 gap-3">
          <Marker step={step} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Icon className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="font-medium">{step.title}</span>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[0.7rem] font-medium text-primary">
                Current step
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
          </div>
        </div>

        <Button asChild size="sm" className="shrink-0 self-start sm:self-auto">
          <Link to={step.action.to}>
            {step.action.label} <ArrowRight />
          </Link>
        </Button>
      </div>
    </li>
  )
}

/** A finished or not-yet-reached step, as a single quiet line. */
function CompactStep({ step }: { step: JourneyStep }) {
  const isDone = step.state === 'done'

  return (
    <li>
      <Link
        to={step.action.to}
        className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
        aria-label={`Step ${step.step} — ${step.title}, ${isDone ? 'completed' : 'not started'}`}
      >
        <Marker step={step} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            isDone ? 'text-muted-foreground' : 'text-foreground/80',
          )}
        >
          {step.title}
        </span>
        {isDone && <span className="shrink-0 text-xs font-medium text-success">Done</span>}
        <ArrowRight
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </Link>
    </li>
  )
}

/**
 * The bubble on the left of a row.
 *
 * An untouched step shows its number, not a padlock: every row here is
 * reachable, and a padlock beside a working link says the opposite.
 */
function Marker({ step }: { step: JourneyStep }) {
  const isCurrent = step.state === 'current'

  if (step.state === 'done') {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="size-3.5" aria-hidden />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        isCurrent
          ? 'size-8 bg-primary text-primary-foreground'
          : 'size-7 bg-muted text-xs text-muted-foreground',
      )}
    >
      {step.step}
    </span>
  )
}
