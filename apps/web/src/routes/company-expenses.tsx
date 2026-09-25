import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Wallet, Pencil, Trash2, Search, Download, Printer, Tags, X, Eye, Paperclip, CheckCircle2, HandCoins } from 'lucide-react'
import type { Expense } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useAccess } from '@/shared/auth/useAccess'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { RowMenu } from '@/shared/ui/row-menu'
import { Card, CardContent } from '@/shared/ui/card'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { cn } from '@/shared/ui/cn'
import { formatINR, humanize } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useExpensePage, useDeleteExpense, useExpenseSummary, useMarkReimbursed } from '@/features/financials/api'
import { PERIOD_LABEL, periodFor, type PeriodKey } from '@/features/financials/period'
import { useProjects } from '@/features/projects/api'
import { useDirectory } from '@/features/team/api'
import { useActiveLookups } from '@/features/settings/api'
import { AddExpenseDialog } from '@/features/expenses/ExpenseDialog'
import { CategoryManager } from '@/features/expenses/CategoryManager'
import { ReceiptsPanel } from '@/features/expenses/ReceiptsPanel'
import { shortDate } from '@/features/billing/status'

const PAGE_SIZE = 25
const PERIOD_PILLS = ['this_month', 'last_month', 'this_fy', 'last_fy', 'all', 'custom'] as const

export function CompanyExpensesPage() {
  return (
    <AuthedPage module="company_expenses">
      <Expenses />
    </AuthedPage>
  )
}

/** What the money in an expense means: what was paid, plus GST when it was entered before tax. */
function cashOut(e: Expense): number {
  const tax = e.tax_amount ?? 0
  if (e.amount_is === 'excluding_tax' && (e.gst_treatment === 'gst_applicable' || e.gst_treatment === 'reverse_charge')) {
    return e.amount + (tax || (e.amount * (e.gst_rate ?? 0)) / 100)
  }
  return e.amount
}

function exportCsv(rows: Expense[]) {
  downloadCsv(
    `expenses-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      ['Date', 'Category', 'Description', 'Project', 'Vendor', 'Paid by', 'Reimbursed', 'Amount', 'GST', 'GST rate', 'Tax', 'Vendor invoice', 'Reverse charge', 'Bills'],
      rows.map((e) => [
        e.expense_date,
        e.category ?? '',
        e.description ?? '',
        e.project_id ?? '',
        e.party_name ?? '',
        e.paid_by_name ?? 'Studio',
        e.paid_by_user_id ? e.reimbursement_status : '',
        e.amount,
        e.gst_treatment,
        e.gst_rate ?? '',
        e.tax_amount ?? '',
        e.invoice_number ?? '',
        e.reverse_charge ? 'yes' : 'no',
        e.attachment_count,
      ]),
    ),
  )
}

/**
 * Every rupee that went out: studio costs and the ones someone paid from
 * their own pocket, in one ledger with the bill attached. Three figures on
 * top, the period as the first filter, and the rest a click away.
 */
function Expenses() {
  const confirm = useConfirm()
  const isMobile = useIsMobile()
  const access = useAccess()
  const canAdd = access.hasAction('company_expenses', 'create')
  const canEdit = access.hasAction('company_expenses', 'edit')
  const canDelete = access.hasAction('company_expenses', 'delete')
  const { data: projects } = useProjects()
  const { data: people } = useDirectory()
  const { data: categories } = useActiveLookups('expense_category')
  const del = useDeleteExpense()
  const reimburse = useMarkReimbursed()

  const [periodKey, setPeriodKey] = useUrlParam('period', 'this_month')
  const [customFrom, setCustomFrom] = useUrlParam('from')
  const [customTo, setCustomTo] = useUrlParam('to')
  const period = periodKey === 'custom' || periodKey === 'all' ? null : periodFor((PERIOD_PILLS.includes(periodKey as never) ? periodKey : 'this_month') as Exclude<PeriodKey, 'custom'>)
  const dateFrom = periodKey === 'custom' ? customFrom : (period?.from ?? '')
  const dateTo = periodKey === 'custom' ? customTo : (period?.to ?? '')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useUrlParam('category')
  const [projectId, setProjectId] = useUrlParam('project')
  const [paidBy, setPaidBy] = useUrlParam('paid_by')
  const [gst, setGst] = useUrlParam('gst')
  const [view, setView] = useUrlParam('view', 'all')
  const [sort, setSort] = useState<'date' | 'amount'>('date')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<Expense | null>(null)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [catsOpen, setCatsOpen] = useState(false)

  // One set of filters, read by the list, its count and the total.
  const filters = {
    search: search.trim() || undefined,
    category: category || undefined,
    project_id: projectId || undefined,
    date_from: view === 'to_reimburse' ? undefined : dateFrom || undefined,
    date_to: view === 'to_reimburse' ? undefined : dateTo || undefined,
    gst: gst || undefined,
    paid_by: paidBy || undefined,
    reimbursement: view === 'to_reimburse' ? ('pending' as const) : undefined,
  }
  const { data: summary } = useExpenseSummary(filters)
  const { data: pageData, isLoading, isError, refetch, isFetching } = useExpensePage({ ...filters, sort, dir, page, page_size: PAGE_SIZE })
  const rows = pageData?.items ?? []
  const total = pageData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const activeCount = [search.trim(), category, projectId, paidBy, gst].filter(Boolean).length + (periodKey !== 'this_month' ? 1 : 0)
  const change = (fn: () => void) => {
    fn()
    setPage(1)
  }

  function resetFilters() {
    change(() => {
      setSearch('')
      setCategory('')
      setProjectId('')
      setPaidBy('')
      setGst('')
      setPeriodKey('this_month')
      setCustomFrom('')
      setCustomTo('')
      setView('all')
    })
  }

  async function onDelete(e: Expense) {
    const yes = await confirm({
      title: 'Delete this expense?',
      description: `${e.category ?? 'Uncategorised'} · ${formatINR(e.amount)}. This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (yes) del.mutate(e.id)
  }

  function onSort(field: 'date' | 'amount') {
    if (sort === field) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(field)
      setDir('desc')
    }
  }

  const menuFor = (e: Expense) => (
    <RowMenu
      label={`More for ${e.category ?? 'this expense'} ${formatINR(e.amount)}`}
      items={[
        { label: 'View', icon: <Eye className="size-4" />, onSelect: () => setDetail(e) },
        ...(canEdit ? [{ label: 'Edit', icon: <Pencil className="size-4" />, onSelect: () => setEditing(e) }] : []),
        ...(canEdit && e.paid_by_user_id && e.reimbursement_status === 'pending'
          ? [{ label: `Paid back to ${e.paid_by_name ?? 'them'}`, icon: <CheckCircle2 className="size-4" />, onSelect: () => reimburse.mutate(e.id) }]
          : []),
        ...(canDelete ? [{ label: 'Delete', icon: <Trash2 className="size-4" />, onSelect: () => void onDelete(e) }] : []),
      ]}
    />
  )

  const paidChip = (e: Expense) =>
    e.paid_by_user_id ? (
      <StatusBadge tone={e.reimbursement_status === 'pending' ? 'warning' : 'neutral'} className="whitespace-nowrap">
        {e.reimbursement_status === 'pending' ? `Owed to ${e.paid_by_name ?? 'them'}` : `Paid by ${e.paid_by_name ?? 'them'}`}
      </StatusBadge>
    ) : null

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Every rupee that went out: studio costs and the ones someone paid from their own pocket."
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setCatsOpen(true)}>
              <Tags /> Categories
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportCsv(rows)} disabled={rows.length === 0}>
              <Download /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={rows.length === 0}>
              <Printer /> Print
            </Button>
            {canAdd && <AddExpenseDialog />}
          </div>
        }
      />

      {summary && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3 sm:p-4">
              <p className="text-xs text-muted-foreground sm:text-sm">Spent this month</p>
              <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{formatINR(summary.this_month)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <p className="text-xs text-muted-foreground sm:text-sm">This financial year</p>
              <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{formatINR(summary.this_fy)}</p>
            </CardContent>
          </Card>
          <button
            type="button"
            onClick={() => change(() => setView(view === 'to_reimburse' ? 'all' : 'to_reimburse'))}
            className={cn('rounded-xl border bg-card p-3 text-left transition-colors sm:p-4', view === 'to_reimburse' ? 'border-primary' : 'border-border hover:border-primary/40')}
            aria-pressed={view === 'to_reimburse'}
          >
            <p className="flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
              <HandCoins className="size-3.5" aria-hidden /> To reimburse
            </p>
            <p className={cn('mt-1 text-lg font-semibold tabular-nums sm:text-xl', summary.to_reimburse > 0 && 'text-warning')}>{formatINR(summary.to_reimburse)}</p>
            <p className="hidden text-xs text-muted-foreground sm:block">{summary.to_reimburse > 0 ? 'Paid by the team, not yet paid back' : 'Nobody is owed'}</p>
          </button>
        </div>
      )}

      <div className="no-print mb-4 flex flex-col gap-3">
        {view !== 'to_reimburse' && (
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Period">
            {PERIOD_PILLS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={periodKey === k}
                onClick={() => change(() => setPeriodKey(k))}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  periodKey === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {k === 'custom' ? 'Custom' : k === 'all' ? 'All time' : PERIOD_LABEL[k]}
              </button>
            ))}
            {periodKey === 'custom' && (
              <>
                <Input type="date" value={customFrom} onChange={(e) => change(() => setCustomFrom(e.target.value))} className="w-40" aria-label="From date" />
                <Input type="date" value={customTo} onChange={(e) => change(() => setCustomTo(e.target.value))} className="w-40" aria-label="To date" />
              </>
            )}
            {period && <span className="text-xs text-muted-foreground">{period.label}</span>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => change(() => setSearch(e.target.value))} placeholder="Search description, invoice…" className="pl-9" aria-label="Search expenses" />
          </div>
          <Select value={category} onChange={(e) => change(() => setCategory(e.target.value))} className="w-full sm:w-40" aria-label="Filter by category">
            <option value="">All categories</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.value}>
                {c.value}
              </option>
            ))}
          </Select>
          <Select value={projectId} onChange={(e) => change(() => setProjectId(e.target.value))} className="w-full sm:w-48" aria-label="Filter by project">
            <option value="">All projects</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select value={paidBy} onChange={(e) => change(() => setPaidBy(e.target.value))} className="w-full sm:w-40" aria-label="Filter by who paid">
            <option value="">Paid by anyone</option>
            {(people ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select value={gst} onChange={(e) => change(() => setGst(e.target.value))} className="w-full sm:w-40" aria-label="Filter by GST">
            <option value="">Any GST</option>
            <option value="gst_applicable">GST charged</option>
            <option value="exempt">Exempt</option>
            <option value="non_gst">No GST</option>
            <option value="reverse_charge">Reverse charge</option>
          </Select>
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X /> Clear
            </Button>
          )}
        </div>
      </div>

      {summary && (
        <p className="mb-3 text-sm text-muted-foreground">
          {summary.count} expense{summary.count === 1 ? '' : 's'} · <b className="text-foreground">{formatINR(summary.total)}</b>
          {summary.tax_total > 0 ? ` · GST ${formatINR(summary.tax_total)}` : ''}
          {view === 'to_reimburse' ? ' · waiting to be paid back' : ''}
          {isFetching ? ' · Refreshing…' : ''}
        </p>
      )}

      {isLoading ? (
        <SkeletonList rows={5} columns={5} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={view === 'to_reimburse' ? 'Nobody is owed anything' : activeCount > 0 ? 'No expenses match' : 'Nothing spent this month yet'}
          description={view === 'to_reimburse' ? 'When someone pays from their pocket, choose them under "Paid by" and it lands here.' : activeCount > 0 ? 'Try another period, or clear the filters.' : 'Add a cost and its bill, and profit stays honest.'}
          action={activeCount > 0 || view === 'to_reimburse' ? <Button variant="outline" onClick={resetFilters}>Clear filters</Button> : canAdd ? <AddExpenseDialog /> : undefined}
        />
      ) : (
        <>
          {isMobile ? (
            <RecordCards>
              {rows.map((e) => (
                <RecordCard
                  key={e.id}
                  title={
                    <span className="flex items-center gap-2">
                      {e.category ?? 'Uncategorised'}
                      {e.attachment_count > 0 && <Paperclip className="size-3.5 text-muted-foreground" aria-label={`${e.attachment_count} bills`} />}
                    </span>
                  }
                  subtitle={[e.description, e.party_name].filter(Boolean).join(' · ') || '—'}
                  badge={paidChip(e) ?? undefined}
                  fields={[
                    { label: 'Date', value: shortDate(e.expense_date) },
                    { label: 'Amount', value: formatINR(cashOut(e)), strong: true },
                  ]}
                  actions={menuFor(e)}
                />
              ))}
            </RecordCards>
          ) : (
            <div className="table-wrap rounded-lg border border-border">
              <table className="table-sticky w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">
                      <button type="button" className="hover:text-foreground" onClick={() => onSort('date')}>
                        Date {sort === 'date' ? (dir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium">Category · What for</th>
                    <th className="px-3 py-2 font-medium">Project · Vendor</th>
                    <th className="px-3 py-2 font-medium">Paid by</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <button type="button" className="hover:text-foreground" onClick={() => onSort('amount')}>
                        Amount {sort === 'amount' ? (dir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{shortDate(e.expense_date)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 font-medium">
                          <Wallet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          {e.category ?? 'Uncategorised'}
                          {e.attachment_count > 0 && (
                            <button type="button" onClick={() => setDetail(e)} className="text-muted-foreground hover:text-foreground" aria-label={`${e.attachment_count} bills attached`}>
                              <Paperclip className="size-3.5" />
                            </button>
                          )}
                        </div>
                        {e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {e.project_id ? (
                          <Link to="/projects/$id" params={{ id: e.project_id }} search={{ tab: 'expenses' }} className="text-primary hover:underline">
                            {(projects ?? []).find((p) => p.id === e.project_id)?.name ?? 'Project'}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Studio</span>
                        )}
                        {e.party_name && <div className="text-muted-foreground">{e.party_name}</div>}
                      </td>
                      <td className="px-3 py-2">{paidChip(e) ?? <span className="text-xs text-muted-foreground">Studio</span>}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatINR(cashOut(e))}
                        {e.gst_treatment !== 'non_gst' && <div className="text-xs font-normal text-muted-foreground">{humanize(e.gst_treatment)}</div>}
                      </td>
                      <td className="px-3 py-2 text-right">{menuFor(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {safePage} of {totalPages} · {total} total
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                  Previous
                </Button>
                <Button size="sm" variant="outline" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent title={detail?.category ?? 'Expense'} description={detail ? `${formatINR(cashOut(detail))} · ${shortDate(detail.expense_date)}` : undefined}>
          {detail && (
            <div className="flex flex-col gap-4">
              <dl className="grid gap-2 text-sm">
                {detail.description && <Row k="What for" v={detail.description} />}
                <Row k="Project" v={detail.project_id ? ((projects ?? []).find((p) => p.id === detail.project_id)?.name ?? 'Project') : 'Studio cost'} />
                {detail.party_name && <Row k="Vendor" v={detail.party_name} />}
                <Row k="Paid by" v={detail.paid_by_name ? `${detail.paid_by_name}${detail.reimbursement_status === 'pending' ? ' · to be paid back' : detail.reimbursement_status === 'reimbursed' ? ` · paid back${detail.reimbursed_at ? ` on ${shortDate(detail.reimbursed_at)}` : ''}` : ''}` : 'The studio'} />
                <Row k="GST" v={`${humanize(detail.gst_treatment)}${detail.gst_rate ? ` · ${detail.gst_rate}%` : ''}${detail.tax_amount ? ` · ${formatINR(detail.tax_amount)} tax` : ''}${detail.reverse_charge ? ' · reverse charge' : ''}`} />
                {detail.invoice_number && <Row k="Vendor invoice" v={detail.invoice_number} />}
              </dl>
              <ReceiptsPanel expenseId={detail.id} canEdit={canEdit} />
              <div className="flex justify-end gap-2">
                {canEdit && detail.paid_by_user_id && detail.reimbursement_status === 'pending' && (
                  <Button variant="outline" size="sm" onClick={() => { reimburse.mutate(detail.id); setDetail(null) }}>
                    <CheckCircle2 /> Paid back
                  </Button>
                )}
                {canEdit && (
                  <Button size="sm" onClick={() => { setEditing(detail); setDetail(null) }}>
                    <Pencil /> Edit
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {editing && <AddExpenseDialog key={editing.id} expense={editing} defaultOpen trigger={<span hidden />} onClosed={() => setEditing(null)} />}
      <CategoryManager open={catsOpen} onOpenChange={setCatsOpen} />
    </>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  )
}

