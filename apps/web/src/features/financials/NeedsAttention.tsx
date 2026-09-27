import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronRight, ReceiptText, TrendingDown, Users } from 'lucide-react'
import type { ProfitAndLoss } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { useBillingOverview } from '@/features/billing/api'
import { useExpenseSummary } from './api'

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
  const access = useAccess()
  const overview = useBillingOverview()
  const expenses = useExpenseSummary({ reimbursement: 'pending' })

  const overdue = overview.data?.overdue
  const reimburse = access.hasModule('company_expenses') ? (expenses.data?.to_reimburse ?? 0) : 0
  const owed = data.rail.owed_to_team
  const losing = data.projects.filter((p) => p.profit < 0).length

  const lines: ReactNode[] = []
  if (overdue && overdue.count > 0) {
    lines.push(
      <Line
        key="overdue"
        icon={<AlertTriangle className="size-4 text-destructive" aria-hidden />}
        label={`${overdue.count} ${overdue.count === 1 ? 'invoice is' : 'invoices are'} overdue`}
        value={formatINR(overdue.amount)}
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
        value={formatINR(reimburse)}
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
        value={formatINR(owed)}
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

  if (lines.length === 0) return null
  return (
    <Card className="border-destructive/30">
      <CardContent className="flex flex-col gap-0.5 p-3">
        <p className="px-2 pb-1 pt-0.5 text-sm font-semibold">Needs attention</p>
        {lines}
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
