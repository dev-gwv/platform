import { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import type { Deliverable } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { useBulkDeliverables } from '@/features/board/api'
import { GiveWorkDialog } from './GiveWorkDialog'
import { STAGE_LABEL, type STAGE_ORDER } from './deliverable-stage'
import { stepsFor } from './stages'
import { useDeliveryFlow } from './stages-api'

/**
 * Everything ticked on the Work tab, changed at once: give them to an editor
 * (the same "Who will edit it?"), set one due date, or move them to a stage.
 */
export function DeliverableBulkBar({ picked, onDone }: { picked: readonly Deliverable[]; onDone: () => void }) {
  const bulk = useBulkDeliverables()
  const flow = useDeliveryFlow()
  const [due, setDue] = useState('')
  const [giving, setGiving] = useState(false)
  const ids = picked.map((d) => d.id)
  const run = (body: Omit<Parameters<typeof bulk.mutate>[0], 'ids'>) => bulk.mutate({ ids, ...body }, { onSuccess: onDone })

  return (
    <div
      role="region"
      aria-label="Change the ticked deliverables"
      className="sticky bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-card p-3 shadow-lg"
    >
      <span className="text-sm font-semibold">{picked.length} ticked</span>
      <Button size="sm" onClick={() => setGiving(true)} disabled={bulk.isPending}>
        <UserPlus /> Give to an editor
      </Button>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (due) run({ estimated_date: due })
        }}
      >
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date for the ticked" className="h-9 w-40" />
        <Button type="submit" size="sm" variant="outline" disabled={!due || bulk.isPending}>
          Set due date
        </Button>
      </form>
      <Select
        value=""
        disabled={bulk.isPending}
        aria-label="Move the ticked to"
        className="h-9 w-40"
        onChange={(e) => {
          const v = e.target.value as (typeof STAGE_ORDER)[number]
          if (v) run({ stage: { status: v, custom_status_code: null } })
        }}
      >
        <option value="">Move to…</option>
        {stepsFor(flow).map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </Select>
      <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
        <X /> Clear
      </Button>
      {giving && (
        <GiveWorkDialog
          deliverables={picked}
          onClose={() => {
            setGiving(false)
            onDone()
          }}
        />
      )}
    </div>
  )
}
