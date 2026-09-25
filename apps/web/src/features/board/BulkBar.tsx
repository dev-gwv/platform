import { useState } from 'react'
import { X } from 'lucide-react'
import type { BoardPerson, StepKey } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import type { Lane } from './board-model'
import { useBulkDeliverables } from './api'

/**
 * What to do with every card ticked on the board: hand them to someone, move
 * them to a stage, or give them a date. One request each; the database checks
 * every row the way it checks one.
 */
export function BulkBar({
  ids,
  people,
  lanes,
  onDone,
}: {
  ids: readonly string[]
  people: readonly BoardPerson[]
  lanes: readonly Lane[]
  onDone: () => void
}) {
  const bulk = useBulkDeliverables()
  const [due, setDue] = useState('')
  const run = (body: Parameters<typeof bulk.mutate>[0]) => bulk.mutate(body, { onSuccess: onDone })
  const list = [...ids]

  return (
    <div
      role="region"
      aria-label="Change the selected deliverables"
      className="sticky bottom-3 z-30 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-card/95 p-3 shadow-lg backdrop-blur"
    >
      <span className="text-sm font-semibold">
        {ids.length} selected
      </span>
      <Select
        value=""
        disabled={bulk.isPending}
        aria-label="Give the selected to"
        className="h-9 w-44"
        onChange={(e) => {
          const v = e.target.value
          if (v) run({ ids: list, assignee_id: v === 'none' ? null : v })
        }}
      >
        <option value="">Give to…</option>
        {people.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            {p.name}
          </option>
        ))}
        <option value="none">No editor</option>
      </Select>
      <Select
        value=""
        disabled={bulk.isPending}
        aria-label="Move the selected to"
        className="h-9 w-44"
        onChange={(e) => {
          const lane = lanes.find((l) => l.key === e.target.value)
          if (lane) run({ ids: list, stage: { status: lane.status as StepKey, custom_status_code: lane.code } })
        }}
      >
        <option value="">Move to…</option>
        {lanes.map((l) => (
          <option key={l.key} value={l.key}>
            {l.label}
          </option>
        ))}
      </Select>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (due) run({ ids: list, estimated_date: due })
        }}
      >
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date for the selected" className="h-9 w-40" />
        <Button type="submit" size="sm" variant="outline" disabled={!due || bulk.isPending}>
          Set due
        </Button>
      </form>
      <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
        <X /> Clear
      </Button>
    </div>
  )
}
