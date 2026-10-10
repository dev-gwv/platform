import type { CrmStatsQuery } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Label } from '@/shared/ui/input'
import { isoDay } from './shared'

/** Presets the desk actually asks about, plus free dates for everything else. */
const PRESETS: ReadonlyArray<{ label: string; range: () => CrmStatsQuery }> = [
  { label: 'Last 7 days', range: () => daysBack(6) },
  { label: 'Last 30 days', range: () => daysBack(29) },
  {
    label: 'This month',
    range: () => {
      const now = new Date()
      return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) }
    },
  },
  {
    label: 'Last month',
    range: () => {
      const now = new Date()
      return {
        from: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    },
  },
  { label: 'Last 90 days', range: () => daysBack(89) },
]

function daysBack(n: number): CrmStatsQuery {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - n)
  return { from: isoDay(from), to: isoDay(to) }
}

export function DateRange({ value, onChange }: { value: CrmStatsQuery; onChange: (v: CrmStatsQuery) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="crm-from">From</Label>
        <Input id="crm-from" type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className="w-40" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="crm-to">To</Label>
        <Input id="crm-to" type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className="w-40" />
      </div>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => {
          const r = p.range()
          const active = r.from === value.from && r.to === value.to
          return (
            <Button key={p.label} size="sm" variant={active ? 'default' : 'outline'} onClick={() => onChange(r)}>
              {p.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
