import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Switch } from '@/shared/ui/switch'
import { Button } from '@/shared/ui/button'
import { humanize } from '@/shared/ui/format'
import { ErrorState } from '@/shared/ui/states'
import { useGopoSummary } from '@/features/gopo/api'
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Wallet,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Briefcase,
  Clock4,
  Receipt,
  Percent,
  Gauge,
  Banknote,
  Building2,
  Users,
  ShieldAlert,
} from 'lucide-react'

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function GopoContent() {
  const [includeSalaries, setIncludeSalaries] = useState(true)
  const { data, isLoading, isError, refetch, isFetching } = useGopoSummary({
    include_salaries: includeSalaries,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="GOPO Dashboard" description="Cash flow health analysis" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  // Was `return null`, which rendered the page completely blank whenever the
  // query failed -- no header, no message, nothing to retry.
  if (isError || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="GOPO Dashboard" description="Cash flow health analysis" />
        <Card>
          <CardContent className="py-2">
            <ErrorState message="We could not work out your cash flow health." onRetry={() => void refetch()} />
          </CardContent>
        </Card>
      </div>
    )
  }

  const { score_card, expense_breakdown, project_performance, attention_items, recent_activity } = data
  const cashReceived = num(data.cash_received, score_card.total_received)
  const pendingReceivable = num(data.pending_receivable, score_card.outstanding_balance)
  const salaryCost = num(data.salary_cost)
  const companyExpenses = num(data.company_expenses)
  const personalExpenses = num(data.personal_expenses)
  const top = data.top_projects ?? [...project_performance].sort((a, b) => b.gross_profit - a.gross_profit).slice(0, 5)
  const bottom = data.bottom_projects ?? [...project_performance].sort((a, b) => a.gross_profit - b.gross_profit).slice(0, 5)
  const signals = data.signals ?? []
  const attentionCount = data.attention_count ?? attention_items.length
  const cashOutflow = score_card.total_expenses + (includeSalaries ? 0 : 0)
  const netCash = cashReceived - cashOutflow
  const cashPosition = netCash

  const healthTone: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
    excellent: 'success',
    good: 'info',
    fair: 'warning',
    poor: 'warning',
    critical: 'danger',
  }

  const severityColors = {
    info: 'border-l-blue-500',
    warning: 'border-l-yellow-500',
    critical: 'border-l-red-500',
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="GOPO Dashboard"
        description="Cash flow health analysis"
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            Refresh
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="min-w-[200px]">
            <Switch checked={includeSalaries} onChange={setIncludeSalaries} label="Include salaries" description="Add salary costs" />
          </div>
          <Button variant="outline" size="sm" asChild className="sm:ml-auto">
            <Link to="/financials/profit">Pick a month instead</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        This scorecard reads the studio&apos;s whole history. For a single month, or a date range, use Monthly
        profit or Financials. Personal expenses are treated as overhead here, not project-level expenses.
      </div>

      {/* Health Score */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Studio Health</CardTitle>
            <StatusBadge tone={healthTone[score_card.health_label] ?? 'neutral'}>
              {score_card.health_label.toUpperCase()}
            </StatusBadge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative h-24 w-24 shrink-0">
              <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeDasharray={`${score_card.health_score * 2.51} 251`}
                  className={
                    score_card.health_score >= 60
                      ? 'text-green-500'
                      : score_card.health_score >= 40
                        ? 'text-yellow-500'
                        : 'text-red-500'
                  }
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xl font-bold">{score_card.health_score}</span>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Collection Rate</p>
                <p className="text-xl font-semibold">{score_card.collection_rate}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Profit Margin</p>
                <p className="text-xl font-semibold">{score_card.profit_margin}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Net Profit</p>
                <p className={`text-xl font-semibold ${score_card.net_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ₹{score_card.net_profit.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding</p>
                <p className="text-xl font-semibold">₹{score_card.outstanding_balance.toLocaleString()}</p>
              </div>
            </div>
          </div>
          {signals.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
              {signals.map((s) => (
                <li key={s} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Overall Health — 9 cards (Lovable parity) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Overall Financial Health</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Project value" value={`₹${score_card.total_revenue.toLocaleString()}`} icon={Briefcase} />
          <StatCard label="Paid income" value={`₹${score_card.total_received.toLocaleString()}`} icon={TrendingUp} />
          <StatCard label="Pending income" value={`₹${pendingReceivable.toLocaleString()}`} icon={Clock4} />
          <StatCard label="Total expenses" value={`₹${score_card.total_expenses.toLocaleString()}`} icon={Receipt} />
          <StatCard label="Net profit" value={`₹${score_card.net_profit.toLocaleString()}`} icon={DollarSign} />
          <StatCard label="Profit margin" value={`${score_card.profit_margin}%`} icon={Percent} />
          <StatCard label="Receivables" value={`₹${score_card.outstanding_balance.toLocaleString()}`} icon={Wallet} />
          <StatCard label="Collection rate" value={`${score_card.collection_rate}%`} icon={Gauge} />
          <StatCard label="Cash position" value={`₹${cashPosition.toLocaleString()}`} icon={Banknote} hint="Cash received minus outflow" />
        </div>
      </section>

      {/* Cash Flow — 4 cards (Lovable parity) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Cash Flow Health</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Cash received" value={`₹${cashReceived.toLocaleString()}`} icon={ArrowDownRight} />
          <StatCard label="Cash outflow" value={`₹${cashOutflow.toLocaleString()}`} icon={ArrowUpRight} />
          <StatCard label="Net cash position" value={`₹${netCash.toLocaleString()}`} icon={Banknote} />
          <StatCard label="Pending receivables" value={`₹${pendingReceivable.toLocaleString()}`} icon={Wallet} />
        </div>
      </section>

      {/* Expense company/personal split (Lovable parity) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Expense Breakdown</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Company expenses" value={`₹${companyExpenses.toLocaleString()}`} icon={Building2} />
          <StatCard label="Personal expenses" value={`₹${personalExpenses.toLocaleString()}`} icon={Wallet} />
          {includeSalaries ? (
            <StatCard label="Salary expenses" value={`₹${salaryCost.toLocaleString()}`} icon={Users} />
          ) : (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                Salaries excluded. Turn on Include salaries to include them.
              </CardContent>
            </Card>
          )}
          <StatCard label="Team cost (projects)" value={`₹${score_card.total_direct_team_cost.toLocaleString()}`} icon={DollarSign} />
        </div>
        {data.rcm_liability != null && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="size-3.5" /> Reverse-charge liability ₹{num(data.rcm_liability).toLocaleString()}
          </p>
        )}
      </section>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Revenue" value={`₹${score_card.total_revenue.toLocaleString()}`} icon={TrendingUp} />
        <StatCard label="Total Received" value={`₹${score_card.total_received.toLocaleString()}`} icon={Wallet} />
        <StatCard label="Total Expenses" value={`₹${score_card.total_expenses.toLocaleString()}`} icon={BarChart3} />
        <StatCard label="Team Cost" value={`₹${score_card.total_direct_team_cost.toLocaleString()}`} icon={DollarSign} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Expense Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {expense_breakdown.map((item) => (
                <div key={item.category} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{item.category.replace(/_/g, ' ')}</span>
                      <span className="text-sm text-muted-foreground">₹{item.amount.toLocaleString()} ({item.percentage}%)</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {expense_breakdown.length === 0 && (
                <p className="text-center text-muted-foreground">No expenses recorded.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Attention Items — 11-count header (Lovable parity) */}
        <Card>
          <CardHeader>
            <CardTitle>
              Needs Attention
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {attentionCount} items
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {attention_items.map((item, i) => (
                <div
                  key={i}
                  className={`border-l-4 bg-muted/50 p-3 rounded-r-lg ${severityColors[item.severity]}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium">{item.message}</p>
                      {item.amount !== null && (
                        <p className="text-xs text-muted-foreground">
                          ₹{item.amount.toLocaleString()}
                        </p>
                      )}
                    </div>
                    {item.severity === 'critical' ? (
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              ))}
              {attention_items.length === 0 && (
                <div className="flex items-center gap-2 py-4 text-center text-muted-foreground">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Everything looks good!</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top / Bottom projects (Lovable parity) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top Projects (by profit)</CardTitle></CardHeader>
          <CardContent>
            {top.length === 0 ? <p className="text-sm text-muted-foreground">No project activity.</p> : (
              <ul className="divide-y divide-border">
                {top.map((p) => (
                  <li key={p.project_id} className="flex items-center justify-between py-2 text-sm">
                    <span className="min-w-0"><span className="block truncate font-medium">{p.project_name}</span><span className="text-xs text-muted-foreground">{humanize(p.status)}</span></span>
                    <span className={`shrink-0 font-semibold ${p.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>₹{p.gross_profit.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Bottom Projects (by profit)</CardTitle></CardHeader>
          <CardContent>
            {bottom.length === 0 ? <p className="text-sm text-muted-foreground">No project activity.</p> : (
              <ul className="divide-y divide-border">
                {bottom.map((p) => (
                  <li key={p.project_id} className="flex items-center justify-between py-2 text-sm">
                    <span className="min-w-0"><span className="block truncate font-medium">{p.project_name}</span><span className="text-xs text-muted-foreground">{humanize(p.status)}</span></span>
                    <span className={`shrink-0 font-semibold ${p.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>₹{p.gross_profit.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Project Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Project Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                  <th className="pb-2 text-right font-medium">Received</th>
                  <th className="pb-2 text-right font-medium">Team Cost</th>
                  <th className="pb-2 text-right font-medium">Expenses</th>
                  <th className="pb-2 text-right font-medium">Profit</th>
                  <th className="pb-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {project_performance.map((p) => (
                  <tr key={p.project_id} className="border-b last:border-0">
                    <td className="py-2">
                      <span className="font-medium">{p.project_name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{humanize(p.status)}</span>
                    </td>
                    <td className="py-2 text-right">₹{p.revenue.toLocaleString()}</td>
                    <td className="py-2 text-right">₹{p.received.toLocaleString()}</td>
                    <td className="py-2 text-right">₹{p.direct_team_cost.toLocaleString()}</td>
                    <td className="py-2 text-right">₹{p.project_expenses.toLocaleString()}</td>
                    <td className={`py-2 text-right font-medium ${p.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ₹{p.gross_profit.toLocaleString()}
                    </td>
                    <td className="py-2 text-right">
                      <span className={p.profit_margin >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {p.profit_margin}%
                      </span>
                    </td>
                  </tr>
                ))}
                {project_performance.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-muted-foreground">No projects found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recent_activity.map((item, i) => (
              <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0">
                <div>
                  <p className="text-sm font-medium">{item.description}</p>
                  <p className="text-xs text-muted-foreground">{item.date}</p>
                </div>
                <span className={`flex items-center gap-1 text-sm font-medium ${item.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                  {item.type === 'income' ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4" />
                  )}
                  ₹{item.amount.toLocaleString()}
                </span>
              </div>
            ))}
            {recent_activity.length === 0 && (
              <p className="py-4 text-center text-muted-foreground">No recent activity.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function GopoPage() {
  return (
    <AuthedPage module="financials">
      <GopoContent />
    </AuthedPage>
  )
}
