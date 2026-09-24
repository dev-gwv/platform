import { ArrowRight, Package } from 'lucide-react'
import type { Deliverable } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { DeliveryPipeline } from './DeliveryPipeline'
import { deliverableCounts } from './deliverable-stage'

/**
 * Where the project's deliverables stand, on the Overview: the same pipeline
 * as the Deliverables tab, read-only, so both screens tell the same story.
 */
export function DeliverablesSummary({
  deliverables,
  onOpen,
}: {
  deliverables: readonly Deliverable[]
  onOpen: () => void
}) {
  const counts = deliverableCounts(deliverables)
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
          <DeliveryPipeline deliverables={deliverables} compact />
        )}
      </CardContent>
    </Card>
  )
}
