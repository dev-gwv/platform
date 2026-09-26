import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import type { JourneyStep } from './journey'

/**
 * The one setup card a new studio sees on its dashboard: how far along it is,
 * and the single step to do now. Nothing else — no list of the other steps,
 * no second button. It goes away for good once setup is done or skipped.
 */
export function SetupJourney({
  current,
  completed,
  total,
}: {
  current: JourneyStep
  completed: number
  total: number
}) {
  return (
    <Card className="mb-6">
      <CardContent className="p-4 sm:p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Set up your studio · {completed} of {total} done
        </p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{current.title}</h2>
            <p className="text-sm text-muted-foreground">{current.why}</p>
          </div>
          <Button asChild className="shrink-0 self-start sm:self-auto">
            <Link to={current.action.to} search={current.action.search as never}>
              {current.action.label} <ArrowRight />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
