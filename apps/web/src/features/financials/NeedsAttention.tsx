import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronRight, Coins, Percent, ReceiptText, Tag, TrendingDown, Users } from 'lucide-react'
import type { ProfitAndLoss } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { useAccess } from '@/shared/auth/useAccess'
import { useBillingOverview } from '@/features/billing/api'
import { useExpenseSummary, useOverCollected } from './api'
import { useINR } from '@/shared/money/MoneyMask'

/**
 * What needs doing about money, on top of Profit & Loss: late invoices,
 * money a teammate spent that is owed back, crew still to pay, and projects
 * losing money in this period. One line each, only when it is not zero, and
 * nothing at all when everything is settled.
 *
 * Every figure is already worked out elsewhere (billing overview, the
 * expenses summary, the P&L itself); this only brings them together.
 */
export function NeedsAttention({ data }: { data: ProfitAndLoss }) {
  const inr = useINR()
  const access = useAccess()
  const overview = useBillingOverview()
  const expenses = useExpenseSummary({ reimbursement: 'pending' })
  const noCategory = useExpenseSummary({ missing: 'category' })
  const overCollected = useOverCollected()
  const [all, setAll] = useState(false)

  const overdue = overview.data?.overdue
  const reimburse = access.hasModule('company_expenses') ? (expenses.data?.to_reimburse ?? 0) : 0
  const owed = data.rail.owed_to_team
  const losing = data.projects.filter((p) => p.profit < 0).length
  // Under 20% kept, but not losing: worth a look before the next quote.
  const thin = data.projects.filter((p) => p.income > 0 && p.profit >= 0 && p.margin != null && p.margin < 20).length
  const uncategorised = access.hasModule('company_expenses') ? (noCategory.data?.count ?? 0) : 0
  const over = overCollected.data ?? []

  const lines: ReactNode[] = []
  if (overdue && overdue.count > 0) {
    lines.push(
      <Line
        key="overdue"
        icon={<AlertTriangle className="size-4 text-destructive" aria-hidden />}
        label={`${overdue.count} ${overdue.count === 1 ? 'invoice is' : 'invoices are'} overdue`}
        value={inr(overdue.amount)}
        to="/billing/invoices"
        search={{ status: 'overdue' }}
      />,
    )
  }
  if (reimburse > 0) {
    lines.push(
      <Line
        key="reimburse"
        icon={<ReceiptText className="size-4 text-tone-amber" aria-hidden />}
        label="To pay back to your team"
        value={inr(reimburse)}
        to="/company-expenses"
        search={{ view: 'to_reimburse' }}
      />,
    )
  }
  if (owed > 0) {
    lines.push(
      <Line
        key="owed"
        icon={<Users className="size-4 text-tone-violet" aria-hidden />}
        label="Owed to the team for shoots"
        value={inr(owed)}
        to="/team-payouts"
      />,
    )
  }
  if (losing > 0) {
    lines.push(
      <Line
        key="loss"
        icon={<TrendingDown className="size-4 text-destructive" aria-hidden />}
        label={`${losing} ${losing === 1 ? 'project is' : 'projects are'} losing money`}
        value="See below"
        href="#pnl-projects"
      />,
    )
  }

  if (thin > 0) {
    lines.push(
      <Line
        key="thin"
        icon={<Percent className="size-4 text-tone-amber" aria-hidden />}
        label={`${thin} ${thin === 1 ? 'project keeps' : 'projects keep'} less than 20% of what came in`}
        value="See below"
        href="#pnl-projects"
      />,
    )
  }
  if (over.length > 0) {
    const first = over[0]!
    lines.push(
      <Line
        key="over"
        icon={<Coins className="size-4 text-tone-amber" aria-hidden />}
        label={
          over.length === 1
            ? `${first.project_name} has received ${inr(-first.receivables)} more than its value`
            : `${over.length} projects have received more than their value`
        }
        value={over.length === 1 ? 'Check' : over.map((p) => p.project_name).slice(0, 2).join(', ')}
        to={`/projects/${first.project_id}`}
        search={{ tab: 'billing' }}
      />,
    )
  }
  if (uncategorised > 0) {
    lines.push(
      <Line
        key="uncategorised"
        icon={<Tag className="size-4 text-muted-foreground" aria-hidden />}
        label={`${uncategorised} ${uncategorised === 1 ? 'expense has' : 'expenses have'} no category`}
        value="Sort them"
        to="/company-expenses"
        search={{ missing: 'category', period: 'all' }}
      />,
    )
  }

  if (lines.length === 0) return null
  return (
    <Card className="border-destructive/30">
      <CardContent className="flex flex-col gap-0.5 p-3">
        <p className="px-2 pb-1 pt-0.5 text-sm font-semibold">Needs attention</p>
        {/* Four at a time, in order of how much they cost to leave. */}
        {all ? lines : lines.slice(0, 4)}
        {lines.length > 4 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="px-2 py-1 text-left text-xs font-medium text-primary hover:underline">
            {all ? 'Show fewer' : `${lines.length - 4} more`}
          </button>
        )}
      </CardContent>
    </Card>
  )
}

function Line({
  icon,
  label,
  value,
  to,
  search,
  href,
}: {
  icon: ReactNode
  label: string
  value: string
  to?: string
  search?: Record<string, string>
  href?: string
}) {
  const body = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <span className="shrink-0 text-sm font-semibold tabular-nums">{value}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  )
  const cls = 'flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted'
  return href ? (
    <a href={href} className={cls}>
      {body}
    </a>
  ) : (
    <Link to={to!} search={search ?? {}} className={cls}>
      {body}
    </Link>
  )
}
