import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import type { JourneyStep } from './journey'
import { SetupCheckpoints } from './SetupCheckpoints'

/**
 * The one card a studio still being set up sees on its dashboard: the three
 * checkpoints, the step to do now, and one button to carry on with it.
 * Nothing else is on the page until setup is done or skipped.
 */
export function SetupJourney({ steps, current }: { steps: JourneyStep[]; current: JourneyStep }) {
  return (
    <Card className="mt-2">
      <CardContent className="p-4 sm:p-5">
        <SetupCheckpoints steps={steps} />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{current.title}</h2>
            <p className="text-sm text-muted-foreground">{current.why}</p>
          </div>
          <Button asChild className="shrink-0 self-start sm:self-auto">
            <Link to={current.action.to} search={current.action.search as never}>
              Continue step {current.step} <ArrowRight />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
