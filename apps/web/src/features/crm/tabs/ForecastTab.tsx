import { useState } from 'react'
import type { CrmStatsQuery } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonTiles } from '@/shared/ui/skeleton'
import { StatCard } from '@/shared/ui/stat-card'
import { ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useForecast } from '../api'
import { DateRange, daysBack } from './DateRange'

function ahead(days: number): CrmStatsQuery {
  const from = new Date()
  const to = new Date()
  to.setDate(to.getDate() + days)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

/**
 * The weighted pipeline: every open deal's value × its probability, plus the
 * won ones, over the window their expected close falls in. By stage, by
 * owner, by month, with the win rate and cycle time of what has closed.
 */
export function ForecastTab() {
  const [range, setRange] = useState<CrmStatsQuery>(() => ahead(90))
  const { data, isLoading, isError, error, refetch } = useForecast(range)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <DateRange value={range} onChange={setRange} />
        </div>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setRange(ahead(90))}>
          Next 90 days
        </button>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setRange(daysBack(29))}>
          Last 30 days
        </button>
      </div>

      {isLoading ? (
        <SkeletonTiles count={4} />
      ) : isError || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Weighted forecast" value={formatINR(data.weighted)} />
            <StatCard label="Open pipeline" value={formatINR(data.open_value)} />
            <StatCard label="Won" value={formatINR(data.won_value)} />
            <StatCard label="Win rate" value={data.win_rate === null ? '—' : `${Math.round(data.win_rate * 100)}%`} />
          </div>
          <p className="text-sm text-muted-foreground">
            {data.count} deal{data.count === 1 ? '' : 's'} expected to close in the range · {data.won_count} won, {data.lost_count} lost
            {data.avg_cycle_days !== null ? ` · ${data.avg_cycle_days} days from arrival to won on average` : ''}.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <p className="font-medium">By stage</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Weighted value, with the full value in grey.</p>
                <Bars rows={data.by_stage.map((s) => ({ label: `${s.name} (${s.count})`, value: s.weighted, total: s.total_value }))} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="font-medium">By owner</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Who is carrying the forecast.</p>
                <Bars rows={data.by_owner.map((o) => ({ label: `${o.name} (${o.count})`, value: o.weighted, total: o.total_value }))} />
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardContent className="p-4">
                <p className="font-medium">By expected close month</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Deals without a close date fall in the month they arrived.</p>
                <Bars rows={data.by_month.map((m) => ({ label: `${monthLabel(m.month)} (${m.count})`, value: m.weighted, total: m.total_value }))} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function Bars({ rows }: { rows: ReadonlyArray<{ label: string; value: number; total: number }> }) {
  if (rows.length === 0) return <p className="mt-4 text-sm text-muted-foreground">Nothing in this range.</p>
  const max = Math.max(1, ...rows.map((r) => r.total))
  return (
    <div className="mt-3 flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-36 truncate text-sm" title={r.label}>
            {r.label}
          </span>
          <div className="relative h-2.5 flex-1 rounded-full bg-muted" role="img" aria-label={`${r.label}: ${formatINR(r.value)} weighted of ${formatINR(r.total)}`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/25" style={{ width: `${Math.round((r.total / max) * 100)}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.round((r.value / max) * 100)}%` }} />
          </div>
          <span className="w-24 text-right text-xs tabular-nums">{formatINR(r.value)}</span>
        </div>
      ))}
    </div>
  )
}
