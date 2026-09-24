import { ArrowRight, Package } from 'lucide-react'
import type { Deliverable } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { STAGE_LABEL, STAGE_ORDER, deliverableCounts, isLate, stageOf } from './deliverable-stage'

const BAR: Record<(typeof STAGE_ORDER)[number], string> = {
  pending: 'bg-muted-foreground/30',
  in_progress: 'bg-tone-blue',
  review: 'bg-tone-amber',
  completed: 'bg-tone-green',
}

/**
 * Where the project's deliverables stand, on the Overview: one bar split by
 * stage, the late ones by name, and a way into the list. Enough to answer
 * "what do we still owe them?" without opening the tab.
 */
export function DeliverablesSummary({
  deliverables,
  onOpen,
}: {
  deliverables: readonly Deliverable[]
  onOpen: () => void
}) {
  const counts = deliverableCounts(deliverables)
  const live = deliverables.filter((d) => stageOf(d.status) !== 'cancelled')
  const late = live.filter((d) => isLate(d))
  const byStage = STAGE_ORDER.map((s) => ({ stage: s, n: live.filter((d) => stageOf(d.status) === s).length }))

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2">
          <Package className="size-4 text-tone-violet" aria-hidden /> Deliverables
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          Open <ArrowRight />
        </Button>
      </CardHeader>
      <CardContent>
        {counts.total === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing owed yet. Add what you promised the client.</p>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-semibold">
                Delivered {counts.delivered} of {counts.total}
              </span>
              {counts.late > 0 && <span className="ml-2 font-medium text-destructive">· {counts.late} late</span>}
            </p>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label="Deliverables by stage">
              {byStage.map(
                ({ stage, n }) =>
                  n > 0 && <div key={stage} className={cn(BAR[stage])} style={{ width: `${(n / counts.total) * 100}%` }} />,
              )}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {byStage.map(({ stage, n }) => (
                <li key={stage} className="flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-full', BAR[stage])} aria-hidden />
                  {STAGE_LABEL[stage]} {n}
                </li>
              ))}
            </ul>
            {late.length > 0 && (
              <p className="mt-2 text-xs text-destructive">Late: {late.map((d) => d.title).join(', ')}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
