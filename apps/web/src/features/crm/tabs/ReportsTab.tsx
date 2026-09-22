import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import type { CrmLead, CrmStatsQuery } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { SkeletonTiles } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { StatCard } from '@/shared/ui/stat-card'
import { ErrorState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { Select } from '@/shared/ui/input'
import { useCrmStats, useForecast } from '../api'
import { STAGES } from '../leads'
import { DateRange, daysBack } from './DateRange'
import { exportLeadsCsv } from './shared'

/** The channels a lead can arrive through — the same list the CRM filters on. */
const SOURCES = [
  'webform',
  'facebook',
  'instagram',
  'whatsapp',
  'google_form',
  'referral',
  'enquiry',
  'manual',
  'csv_import',
  'other',
] as const

export function ReportsTab({ leads }: { leads: readonly CrmLead[] }) {
  const [range, setRange] = useState<CrmStatsQuery>(() => daysBack(29))
  /** Owners taken from the leads on hand, so the list only offers real ones. */
  const owners = [
    ...new Map(
      leads
        .filter((l) => l.assigned_to && l.assignee_name)
        .map((l) => [l.assigned_to as string, l.assignee_name as string]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const { data, isLoading, isError, error, refetch } = useCrmStats(range)

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <DateRange value={range} onChange={setRange} />
        </div>
        {/* "How is Instagram doing" and "how is Priya doing" are the two
            questions asked of this screen, and a date range answers neither. */}
        <Select
          value={range.source ?? ''}
          aria-label="Filter by source"
          className="w-40"
          onChange={(e) => {
            const v = e.target.value
            setRange(({ source: _drop, ...rest }) => (v ? { ...rest, source: v } : rest))
          }}
        >
          <option value="">All sources</option>
          {SOURCES.map((o) => (
            <option key={o} value={o}>
              {humanize(o)}
            </option>
          ))}
        </Select>
        <Select
          value={range.assignee ?? ''}
          aria-label="Filter by owner"
          className="w-44"
          onChange={(e) => {
            const v = e.target.value
            setRange(({ assignee: _drop, ...rest }) => (v ? { ...rest, assignee: v } : rest))
          }}
        >
          <option value="">All members</option>
          {owners.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => window.print()} title="Print this report">
          <Printer /> Print
        </Button>
      </div>

      {isLoading ? (
        <SkeletonTiles count={4} />
      ) : isError || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="New leads" value={data.created} />
            <StatCard label="Won" value={data.won} />
            <StatCard label="Lost" value={data.lost} />
            <StatCard label="Conversion" value={`${Math.round(data.conversion_rate * 100)}%`} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <p className="font-medium">Pipeline by stage</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Every open and closed lead right now.</p>
                <Bars rows={STAGES.map((s) => [s.label, data.byStatus[s.key] ?? 0])} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="font-medium">Arrivals by source</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Leads created in the range, by where they came from.</p>
                {Object.keys(data.bySource).length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">No leads arrived in this range.</p>
                ) : (
                  <Bars rows={Object.entries(data.bySource).sort((a, b) => b[1] - a[1])} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="font-medium">Right now</p>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <Stat label="Open + closed" value={data.total} />
                  <Stat label="Overdue" value={data.overdue} tone="text-destructive" />
                  <Stat label="Uncontacted" value={data.uncontacted} tone="text-warning" />
                </dl>
              </CardContent>
            </Card>
            <ForecastCard range={range} />
            <LostCard data={data} />
            <Card>
              <CardContent className="p-4">
                <p className="font-medium">Export</p>
                <p className="mt-0.5 text-xs text-muted-foreground">A CSV of every lead in the inbox, for sheets.</p>
                <Button className="mt-3" variant="outline" size="sm" onClick={() => exportLeadsCsv(leads)}>
                  <Download /> Download CSV ({leads.length})
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

/** Σ value × probability over the deals expected to close in the range. */
function ForecastCard({ range }: { range: CrmStatsQuery }) {
  const { data, isLoading, isError, error, refetch } = useForecast(range)
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-medium">Forecast</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Deals expected to close in the range, weighted by their probability.</p>
        {isLoading ? (
          <SkeletonTiles count={2} />
        ) : isError || !data ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Weighted</dt>
                <dd className="text-xl font-semibold tabular-nums">{formatINR(data.weighted)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Won</dt>
                <dd className="text-xl font-semibold tabular-nums text-success">{formatINR(data.won_value)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Open</dt>
                <dd className="text-xl font-semibold tabular-nums">{formatINR(data.open_value)}</dd>
              </div>
            </dl>
            {data.by_stage.length > 0 && (
              <Bars rows={data.by_stage.map((s) => [s.name, Math.round(s.weighted)])} money />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Where lost deals went, and to whom — the range's post-mortem. */
function LostCard({ data }: { data: { lost: number; byLostReason: Record<string, number>; byCompetitor: Record<string, number> } }) {
  const reasons = Object.entries(data.byLostReason).sort((a, b) => b[1] - a[1])
  const competitors = Object.entries(data.byCompetitor).sort((a, b) => b[1] - a[1])
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-medium">Lost analysis</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{data.lost} lost in this range.</p>
        {reasons.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing lost — or no reasons recorded yet.</p>
        ) : (
          <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">By reason</p>
            <Bars rows={reasons} />
          </>
        )}
        {competitors.length > 0 && (
          <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">By competitor</p>
            <Bars rows={competitors} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</dd>
    </div>
  )
}

function Bars({ rows, money = false }: { rows: ReadonlyArray<readonly [string, number]>; money?: boolean }) {
  const max = Math.max(1, ...rows.map(([, v]) => v))
  return (
    <div className="mt-3 flex flex-col gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-28 truncate text-sm">{label}</span>
          <div className="h-2 flex-1 rounded-full bg-muted" role="img" aria-label={`${label}: ${value}`}>
            <div className="h-2 rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((value / max) * 100)}%` }} />
          </div>
          <span className={`${money ? 'w-20' : 'w-8'} text-right text-xs tabular-nums`}>{money ? formatINR(value) : value}</span>
        </div>
      ))}
    </div>
  )
}
