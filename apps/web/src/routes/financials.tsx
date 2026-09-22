import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { TrendingUp, Wallet, IndianRupee, AlertTriangle, Receipt, Percent, Gauge, ShieldAlert, Tags, FileWarning } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatCard } from '@/shared/ui/stat-card'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { BarChart, ShareChart } from '@/shared/ui/chart'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatINR } from '@/shared/ui/format'
import { useProjectFinancials, useFinancialOverview } from '@/features/financials/api'

export function FinancialsPage() {
  return (
    <AuthedPage module="financials">
      <Financials />
    </AuthedPage>
  )
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function Financials() {
  const { data, isLoading, isError, refetch } = useProjectFinancials()
  const isMobile = useIsMobile()
  // Lovable parity: overview endpoint (date filter + salaries + GST/RCM +
  // receivables/collection/margin + attention + recent). Cards render above
  // the per-project table; the table itself is unchanged.
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [includeSalaries, setIncludeSalaries] = useState(true)
  const overview = useFinancialOverview(startDate || undefined, endDate || undefined, includeSalaries)

  const o = overview.data
  const recent = Array.isArray(o?.recent) ? (o!.recent as Record<string, unknown>[]) : []
  const attention = Array.isArray(o?.attention) ? (o!.attention as Record<string, unknown>[]) : []

  return (
    <>
      <PageHeader
        title="Financials"
        description="Profit per project (booked value) with an overview across payments, expenses, and salaries."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/financials/gopo">GOPO dashboard</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/financials/profit">Monthly profit</Link>
            </Button>
          </div>
        }
      />

      {/* ── Overview filter bar (Lovable parity) ── */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-[140px] flex-1">
            <Label htmlFor="fin-from">From</Label>
            <Input id="fin-from" type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
          </div>
          <div className="min-w-[140px] flex-1">
            <Label htmlFor="fin-to">To</Label>
            <Input id="fin-to" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className="mt-1" />
          </div>
          <div className="min-w-[200px]">
            <Switch checked={includeSalaries} onChange={setIncludeSalaries} label="Include salaries" description="Add paid salary expenses" />
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStartDate('')
                setEndDate('')
                setIncludeSalaries(true)
              }}
            >
              Reset
            </Button>
            <Button variant="outline" size="sm" onClick={() => void overview.refetch()} disabled={overview.isFetching}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {o?.salaries_warning && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {o.salaries_warning}
        </div>
      )}

      {/* ── Overview cards (Lovable parity) ── */}
      {overview.isLoading ? (
        <SkeletonList rows={2} columns={4} />
      ) : overview.isError ? (
        <div className="mb-4">
          <ErrorState message="We could not load the financial overview." onRetry={() => void overview.refetch()} />
        </div>
      ) : o ? (
        <div className="mb-6 space-y-4">
          <div>
            <h2 className="mb-2 text-sm font-semibold tracking-tight">Key financials</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Net profit" value={formatINR(num(o.net_profit, num(o.received) - num(o.company_expenses) - num(o.personal_expenses) - (includeSalaries ? num(o.salaries) : 0)))} icon={TrendingUp} hint="Received minus expenses" />
              <StatCard label="Expected profit" value={formatINR(num(o.expected_profit, num(o.revenue) - num(o.company_expenses) - num(o.personal_expenses) - (includeSalaries ? num(o.salaries) : 0)))} icon={IndianRupee} hint="Booked value minus expenses" />
              <StatCard label="Receivables" value={formatINR(num(o.receivables))} icon={Wallet} />
              <StatCard label="Collection rate" value={`${num(o.collection_rate).toFixed(1)}%`} icon={Gauge} />
              <StatCard label="Margin" value={o.margin == null ? '—' : `${num(o.margin).toFixed(1)}%`} icon={Percent} />
              <StatCard label="Total expenses" value={formatINR(num(o.total_expenses, num(o.company_expenses) + num(o.personal_expenses) + (includeSalaries ? num(o.salaries) : 0)))} icon={Receipt} />
              <StatCard label="GST collected" value={formatINR(num(o.gst_collected))} icon={Receipt} hint={`Paid: ${formatINR(num(o.gst_paid))}`} />
              <StatCard label="Reverse charge" value={formatINR(num(o.rcm_liability))} icon={ShieldAlert} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard label="Uncategorized expenses" value={String(num(o.uncategorized_count))} icon={Tags} hint="Need a category" />
            <StatCard label="Missing invoices" value={String(num(o.missing_invoice_count))} icon={FileWarning} hint="Missing invoice number" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold tracking-tight">Recent activity</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">Latest payments in range.</p>
                {recent.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">No recent activity in this range.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-border">
                    {recent.slice(0, 8).map((r, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {String(r['type'] ?? 'payment')} · {String(r['date'] ?? '')}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">{formatINR(num(r['amount']))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <h2 className="flex items-center gap-2 font-semibold tracking-tight">
                  <AlertTriangle className="size-4 text-muted-foreground" /> Attention items
                  {typeof o.attention_count === 'number' && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{o.attention_count}</span>
                  )}
                </h2>
                {attention.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">Nothing needs attention right now.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {attention.map((a, i) => (
                      <li key={i} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                        <span>{String(a['message'] ?? a['kind'] ?? 'Needs attention')}</span>
                        {typeof a['amount'] === 'number' && (
                          <span className="ml-2 font-semibold tabular-nums">{formatINR(a['amount'] as number)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <SkeletonList rows={5} columns={5} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No financial data yet"
          description="Profit is computed from project revenue and the costs booked against it. Create a project to start."
          action={
            <Button variant="outline" asChild>
              <Link to="/projects">Go to projects</Link>
            </Button>
          }
        />
      ) : (
        <ProjectTable data={data} isMobile={isMobile} />
      )}
    </>
  )
}

function ProjectTable({
  data,
  isMobile,
}: {
  data: { project_id: string; name: string; revenue: number; received: number; direct_team_cost: number; project_expenses: number; gross_profit: number; balance_pending: number }[]
  isMobile: boolean
}) {
  const totalRevenue = data.reduce((s, p) => s + p.revenue, 0)
  const totalGross = data.reduce((s, p) => s + p.gross_profit, 0)
  const totalPending = data.reduce((s, p) => s + p.balance_pending, 0)

  // Projects carry no dates here, so a time trend would be invented. What the
  // data does support is which projects earned, and where revenue went.
  const byProfit = [...data]
    .sort((a, b) => b.gross_profit - a.gross_profit)
    .slice(0, 8)
    .map((p) => ({ label: p.name, value: p.gross_profit }))

  const split = [
    { label: 'Gross profit', value: Math.max(0, totalGross) },
    { label: 'Team cost', value: data.reduce((s, p) => s + p.direct_team_cost, 0) },
    { label: 'Project expenses', value: data.reduce((s, p) => s + p.project_expenses, 0) },
  ]

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total revenue" value={formatINR(totalRevenue)} icon={IndianRupee} />
        <StatCard label="Gross profit" value={formatINR(totalGross)} icon={TrendingUp} />
        <StatCard label="Pending" value={formatINR(totalPending)} icon={Wallet} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold tracking-tight">Profit by project</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The eight best earners. Hover a bar for the figure.
            </p>
            <BarChart className="mt-4" points={byProfit} format={formatINR} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold tracking-tight">Where the revenue goes</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Profit against what it cost to earn it.
            </p>
            <ShareChart className="mt-4" points={split} format={formatINR} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
      {isMobile ? (
        <RecordCards>
          {data.map((p) => (
            <RecordCard
              key={p.project_id}
              title={p.name}
              badge={
                <span
                  className={`font-semibold tabular-nums ${p.gross_profit < 0 ? 'text-destructive' : 'text-success'}`}
                >
                  {formatINR(p.gross_profit)}
                </span>
              }
              fields={[
                { label: 'Revenue', value: formatINR(p.revenue) },
                { label: 'Team cost', value: formatINR(p.direct_team_cost) },
                { label: 'Expenses', value: formatINR(p.project_expenses) },
              ]}
            />
          ))}
        </RecordCards>
      ) : (
      <div className="table-wrap rounded-lg border border-border">
        <table className="table-sticky w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 text-right font-medium">Revenue</th>
              <th className="px-4 py-2 text-right font-medium">Team cost</th>
              <th className="px-4 py-2 text-right font-medium">Expenses</th>
              <th className="px-4 py-2 text-right font-medium">Gross profit</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.project_id} className="border-t border-border">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-right">{formatINR(p.revenue)}</td>
                <td className="px-4 py-2 text-right text-muted-foreground">{formatINR(p.direct_team_cost)}</td>
                <td className="px-4 py-2 text-right text-muted-foreground">{formatINR(p.project_expenses)}</td>
                <td className={`px-4 py-2 text-right font-semibold ${p.gross_profit < 0 ? 'text-destructive' : 'text-success'}`}>
                  {formatINR(p.gross_profit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      </div>
    </>
  )
}
