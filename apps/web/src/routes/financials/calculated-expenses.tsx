import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, IndianRupee, TrendingUp, Wallet } from 'lucide-react'
import type { ProfitabilitySortBy } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Card, CardContent } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { formatINR, humanize } from '@/shared/ui/format'
import { useProfitabilityReport } from '@/features/financials/api'

const BALANCE_TONE = { pending: 'warning', settled: 'success', over_collected: 'info' } as const
const PROFIT_TONE = { loss: 'danger', low_margin: 'warning', healthy: 'info', strong: 'success' } as const

const COLUMNS: { key: ProfitabilitySortBy; label: string; align?: 'right' }[] = [
  { key: 'project_name', label: 'Project' },
  { key: 'client_name', label: 'Client' },
  { key: 'status', label: 'Status' },
  { key: 'total_cost', label: 'Value', align: 'right' },
  { key: 'paid_income', label: 'Paid', align: 'right' },
  { key: 'receivables', label: 'Receivable', align: 'right' },
  { key: 'company_expense_total', label: 'Expenses', align: 'right' },
  { key: 'gross_profit', label: 'Gross profit', align: 'right' },
  { key: 'gross_margin', label: 'Margin', align: 'right' },
  { key: 'collection_rate', label: 'Collected', align: 'right' },
]

/** Builds a CSV from the loaded page only -- the original's export never fetched beyond the current page either. */
function downloadCsv(rows: ReturnType<typeof useProfitabilityReport>['data']) {
  if (!rows) return
  const header = [
    'Project', 'Client', 'Status', 'Created',
    'Total value', 'Paid income', 'Receivables', 'Expenses',
    'Gross profit', 'Expected profit', 'Gross margin %', 'Expected margin %',
    'Collection rate %', 'Expense ratio %', 'Balance status', 'Profitability',
  ]
  const lines = rows.items.map((i) =>
    [
      i.project_name, i.client_name ?? '', i.project_status ?? '', i.created_at.slice(0, 10),
      i.project_total_value, i.paid_income, i.receivables, i.company_expense_total,
      i.gross_profit, i.expected_project_profit, i.gross_margin, i.expected_margin,
      i.collection_rate, i.expense_ratio, i.balance_status, i.profitability_status,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  )
  const csv = [header.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `profitability-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function CalculatedExpensesContent() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<ProfitabilitySortBy>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const { data, isLoading, isError, refetch } = useProfitabilityReport({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    status: status || undefined,
    search: search || undefined,
    sort_by: sortBy,
    sort_direction: sortDirection,
    page,
    page_size: 50,
  })

  function toggleSort(col: ProfitabilitySortBy) {
    if (col === sortBy) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(col)
      setSortDirection('desc')
    }
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profitability report"
        description="Per-project income, expense and margin -- sortable, filterable, exportable."
        actions={
          <Button variant="outline" size="sm" onClick={() => downloadCsv(data)} disabled={!data?.items.length}>
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <label className="text-sm font-medium">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} />
          </div>
          <div>
            <label className="text-sm font-medium">To</label>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} />
          </div>
          <div>
            <label className="text-sm font-medium">Status</label>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-36">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
          <div className="min-w-48 flex-1">
            <label className="text-sm font-medium">Search</label>
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Project or client name" />
          </div>
          {(dateFrom || dateTo || status || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDateFrom(''); setDateTo(''); setStatus(''); setSearch(''); setPage(1) }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : isError || !data ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No matching projects" description="Try widening the date range or clearing filters." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Projects" value={data.summary.project_count} icon={TrendingUp} />
            <StatCard label="Total value" value={formatINR(data.summary.total_project_value)} icon={IndianRupee} />
            <StatCard label="Paid" value={formatINR(data.summary.total_paid_income)} icon={Wallet} />
            <StatCard label="Receivable" value={formatINR(data.summary.total_receivables)} icon={Wallet} />
            <StatCard label="Gross profit" value={formatINR(data.summary.total_gross_profit)} icon={TrendingUp} />
            <StatCard label="Avg margin" value={`${data.summary.average_gross_margin}%`} icon={TrendingUp} />
          </div>

          <div className="table-wrap rounded-lg border border-border">
            <table className="table-sticky w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`cursor-pointer select-none px-4 py-2 font-medium ${col.align === 'right' ? 'text-right' : ''}`}
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                        {col.label}
                        {sortBy === col.key ? (
                          sortDirection === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-30" />
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-2 font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.project_id} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{p.project_name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{p.client_name ?? '—'}</td>
                    <td className="px-4 py-2">{p.project_status && <StatusBadge>{humanize(p.project_status)}</StatusBadge>}</td>
                    <td className="px-4 py-2 text-right">{formatINR(p.project_total_value)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(p.paid_income)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(p.receivables)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{formatINR(p.company_expense_total)}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${p.gross_profit < 0 ? 'text-destructive' : 'text-success'}`}>
                      {formatINR(p.gross_profit)}
                    </td>
                    <td className="px-4 py-2 text-right">{p.gross_margin}%</td>
                    <td className="px-4 py-2 text-right">{p.collection_rate}%</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge tone={BALANCE_TONE[p.balance_status]}>{humanize(p.balance_status)}</StatusBadge>
                        <StatusBadge tone={PROFIT_TONE[p.profitability_status]}>{humanize(p.profitability_status)}</StatusBadge>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {data.pagination.page} of {data.pagination.total_pages} · {data.pagination.total_count} projects
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function CalculatedExpensesPage() {
  return (
    <AuthedPage module="financials">
      <CalculatedExpensesContent />
    </AuthedPage>
  )
}
