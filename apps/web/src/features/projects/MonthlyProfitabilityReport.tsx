import { useState } from 'react'
import { AlertTriangle, Building2, ChevronRight, Info, PiggyBank, Sigma, TrendingUp, Wallet } from 'lucide-react'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonTiles } from '@/shared/ui/skeleton'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useMonthlyProfitSummary, useProfitabilityReport } from '@/features/financials/api'

/**
 * This project's month, with the studio's fixed costs shared across it.
 *
 * The Billing tab used to show a flat list of package cost, received and
 * balance — the money that came in, and nothing about what the project cost to
 * run. A wedding that booked ₹1.5L is not profitable on its own terms; it is
 * profitable after its crew, its own expenses, and its share of the month's
 * salaries and rent.
 *
 * Every figure here uses the same definitions as the Monthly profit screen, so
 * a project's row there and this panel can never disagree.
 */
const ALLOCATIONS = [
  { value: 'equal', label: 'Equal by project count', hint: 'Splits the month’s fixed cost evenly across eligible projects.' },
  { value: 'revenue', label: 'By revenue share', hint: 'Projects that brought in more money carry more of the fixed cost.' },
  { value: 'headcount', label: 'By headcount', hint: 'Split evenly — no per-project headcount is recorded yet.' },
  { value: 'shoot_days', label: 'By shoot days', hint: 'Split evenly — no per-project day count is recorded yet.' },
] as const

const monthStart = (d: Date) => `${d.toISOString().slice(0, 7)}-01`
const monthEnd = (month: string) => {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

function Figure({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Wallet
  label: string
  value: string
  hint: string
  tone: 'revenue' | 'variable' | 'fixed' | 'actual' | 'profit'
}) {
  const tones = {
    revenue: 'border-primary/30 bg-primary/5 text-primary',
    variable: 'border-warning/30 bg-warning/5 text-warning',
    fixed: 'border-warning/30 bg-warning/5 text-warning',
    actual: 'border-destructive/30 bg-destructive/5 text-destructive',
    profit: 'border-success/30 bg-success/5 text-success',
  } as const
  return (
    <div className={cn('rounded-lg border p-3', tones[tone])}>
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  )
}

export function MonthlyProfitabilityReport({
  projectId,
  bookedRevenue,
}: {
  projectId: string
  bookedRevenue: number
}) {
  const [month, setMonth] = useState(() => monthStart(new Date()))
  const [alloc, setAlloc] = useState<string>('equal')
  const [showProjects, setShowProjects] = useState(false)
  const [showVariable, setShowVariable] = useState(false)

  const summary = useMonthlyProfitSummary(month, 'booked', alloc)
  const report = useProfitabilityReport({
    date_from: month,
    date_to: monthEnd(month),
    sort_by: 'gross_profit',
    sort_direction: 'desc',
    page: 1,
    page_size: 200,
  })

  if (summary.isLoading || report.isLoading) return <SkeletonTiles count={5} />

  const items = report.data?.items ?? []
  const mine = items.find((i) => i.project_id === projectId)
  const fixedTotal = summary.data?.fixed_total ?? 0
  const totalPaid = items.reduce((s, i) => s + i.paid_income, 0)

  // Same rule as the Monthly profit screen, deliberately: equal and headcount
  // split evenly, revenue splits by paid share, shoot_days has no day counts
  // so it falls back to even.
  const allocated =
    items.length === 0 || fixedTotal <= 0
      ? 0
      : alloc === 'revenue' && totalPaid > 0
        ? (fixedTotal * (mine?.paid_income ?? 0)) / totalPaid
        : fixedTotal / items.length

  const variable = mine?.company_expense_total ?? 0
  const actual = variable + allocated
  const profit = bookedRevenue - actual
  const method = ALLOCATIONS.find((a) => a.value === alloc) ?? ALLOCATIONS[0]

  return (
    <Card>
      <CardContent className="p-4 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold tracking-tight">
              <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
              Monthly profitability report
              <StatusBadge tone="neutral">Fixed cost allocation</StatusBadge>
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              A month’s view, used to share the studio’s fixed overheads across this project. It does not change
              what the client paid — the figures above are the project’s own totals.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mpr-month">Profit month</Label>
            <Input
              id="mpr-month"
              type="month"
              value={month.slice(0, 7)}
              onChange={(e) => setMonth(`${e.target.value}-01`)}
              className="w-44"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mpr-alloc">Allocation method</Label>
            <Select id="mpr-alloc" value={alloc} onChange={(e) => setAlloc(e.target.value)} className="w-56">
              {ALLOCATIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
            <p className="text-[11px] text-muted-foreground">{method.hint}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Figure
            icon={TrendingUp}
            tone="revenue"
            label="Booked revenue"
            value={formatINR(bookedRevenue)}
            hint="The whole value booked for this project — package plus approved add-ons."
          />
          <Figure
            icon={Wallet}
            tone="variable"
            label="Variable cost"
            value={formatINR(variable)}
            hint="Crew payouts and expenses attached directly to this project in the month."
          />
          <Figure
            icon={Building2}
            tone="fixed"
            label="Allocated fixed cost"
            value={formatINR(allocated)}
            hint={`This project's share of the month's salaries and office overhead (${method.label.toLowerCase()}).`}
          />
          <Figure
            icon={Sigma}
            tone="actual"
            label="Actual cost"
            value={formatINR(actual)}
            hint="Variable cost plus allocated fixed cost."
          />
          <Figure
            icon={PiggyBank}
            tone="profit"
            label="Project profit (with allocation)"
            value={formatINR(profit)}
            hint="Booked revenue minus actual cost — what this project is worth once it carries its share of the month."
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setShowVariable((v) => !v)}
            aria-expanded={showVariable}
            className="flex items-center justify-between rounded-lg border border-border p-3 text-left text-sm transition-colors hover:bg-accent"
          >
            <span>Variable cost — how it is made up</span>
            <ChevronRight className={cn('size-4 shrink-0 transition-transform', showVariable && 'rotate-90')} />
          </button>
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              Allocated fixed cost
              <StatusBadge tone="neutral">
                across {items.length} project{items.length === 1 ? '' : 's'}
              </StatusBadge>
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{formatINR(allocated)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              From a pool of {formatINR(fixedTotal)} for {month.slice(0, 7)}, shared across every project still
              running.
            </p>
          </div>
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">Total actual cost</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{formatINR(actual)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Variable plus allocated fixed.</p>
          </div>
        </div>

        {showVariable && (
          <div className="mt-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
            {variable === 0 ? (
              <p className="text-muted-foreground">
                Nothing attached to this project in {month.slice(0, 7)} — no crew payouts and no project expenses.
              </p>
            ) : (
              <p className="text-muted-foreground">
                {formatINR(variable)} of expenses booked against this project in the month. The Expenses tab lists
                them line by line.
              </p>
            )}
          </div>
        )}

        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Fixed costs — salaries plus office overhead — are divided across every project that is not cancelled,
          using the method above; variable costs stay with this project alone. The month scopes payments and
          expenses only: booked revenue is always the project’s whole value, not a slice of it, so a long project
          is compared against what it is actually worth.
        </p>

        <button
          type="button"
          onClick={() => setShowProjects((v) => !v)}
          aria-expanded={showProjects}
          className="mt-2 flex w-full items-center justify-between rounded-lg border border-border p-3 text-left text-sm transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2">
            <ChevronRight className={cn('size-4 shrink-0 transition-transform', showProjects && 'rotate-90')} />
            Projects sharing this month’s fixed cost
          </span>
          <StatusBadge tone="neutral">
            {items.length} project{items.length === 1 ? '' : 's'}
          </StatusBadge>
        </button>
        {showProjects && (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {items.length === 0 ? (
              <li className="p-3 text-sm text-muted-foreground">Nothing in this month.</li>
            ) : (
              items.map((i) => (
                <li key={i.project_id} className="flex flex-wrap items-center gap-2 p-2.5 text-sm">
                  <span className={cn('min-w-0 flex-1 truncate', i.project_id === projectId && 'font-medium')}>
                    {i.project_name}
                    {i.project_id === projectId && <span className="ml-2 text-xs text-muted-foreground">this project</span>}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{formatINR(i.paid_income)} received</span>
                </li>
              ))
            )}
          </ul>
        )}

        {/* The two things that quietly make this number wrong. */}
        <div className="mt-3 flex flex-col gap-2">
          {variable === 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              No crew payout or expense is attached to this project for this month, so the profit above is likely
              overstated.
            </p>
          )}
          {fixedTotal === 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              No salaries or fixed overheads are recorded for {month.slice(0, 7)}, so nothing has been allocated.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
