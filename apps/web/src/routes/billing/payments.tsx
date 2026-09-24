import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, Download, ChevronLeft, ChevronRight, Eye, Pencil, Trash2, Copy, Mail, MessageCircle, Receipt } from 'lucide-react'
import type { ReceivedPayment } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { RowMenu } from '@/shared/ui/row-menu'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatINR } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { PERIOD_LABEL, periodFor, type PeriodKey } from '@/features/financials/period'
import { Card, CardContent } from '@/shared/ui/card'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { useReceivedPayments, type ReceivedPaymentFilters } from '@/features/billing/api'
import { useClients } from '@/features/clients/api'
import { useProjects } from '@/features/projects/api'
import {
  ReceivedPaymentDialog,
  ViewReceivedPaymentDialog,
  DeleteReceivedPaymentDialog,
} from '@/features/billing/ReceivedPaymentDialogs'
import { SendReceiptDialog } from '@/features/billing/SendReceiptDialog'
import { copyReceiptLink, openReceiptWhatsApp, receiptShareText, issueReceiptLink } from '@/features/billing/receiptShare'
import { shortDate } from '@/features/billing/status'

export function PaymentsPage() {
  return (
    <AuthedPage module="billing">
      <PageHeader title="Payments received" description="Every rupee that came in, with its receipt number, project and invoice." />
      <PaymentsSection />
    </AuthedPage>
  )
}

const PAYMENT_PAGE_SIZE = 25
type PaymentStatusFilter = 'all' | 'paid' | 'pending' | 'gst'
const PERIOD_KEYS = ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_fy', 'last_fy'] as const
const PERIOD_PILLS = ['this_month', 'last_month', 'this_fy', 'last_fy', 'all', 'custom'] as const
const MODES = ['UPI', 'Cash', 'Bank transfer', 'Cheque', 'Card']

const PAYMENT_TONE = { paid: 'success', pending: 'warning' } as const

function PaymentsSection() {
  const isMobile = useIsMobile()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusParam, setStatusParam] = useUrlParam('status', 'all')
  const status = (['all', 'paid', 'pending', 'gst'].includes(statusParam) ? statusParam : 'all') as PaymentStatusFilter
  const setStatus = (v: PaymentStatusFilter) => setStatusParam(v)
  const [clientId, setClientId] = useUrlParam('client')
  const [projectId, setProjectId] = useUrlParam('project')
  // The period is the filter people reach for first: this month, last month,
  // the financial year. Custom dates stay for the odd question.
  const [periodKey, setPeriodKey] = useUrlParam('period', 'this_fy')
  const [customFrom, setCustomFrom] = useUrlParam('from')
  const [customTo, setCustomTo] = useUrlParam('to')
  const period = periodKey === 'custom' || periodKey === 'all' ? null : periodFor((PERIOD_KEYS.includes(periodKey as never) ? periodKey : 'this_fy') as Exclude<PeriodKey, 'custom'>)
  const from = periodKey === 'custom' ? customFrom : (period?.from ?? '')
  const to = periodKey === 'custom' ? customTo : (period?.to ?? '')
  const [mode, setMode] = useUrlParam('mode')
  const [sortBy, setSortBy] = useState('date_received')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<ReceivedPayment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReceivedPayment | null>(null)
  const [emailTarget, setEmailTarget] = useState<ReceivedPayment | null>(null)
  const { data: clientsData } = useClients()
  const clients = Array.isArray(clientsData) ? clientsData : (clientsData?.items ?? [])
  const { data: projects } = useProjects()

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const filters: ReceivedPaymentFilters = {
    search: search || undefined,
    status,
    client_id: clientId || undefined,
    project_id: projectId || undefined,
    date_from: from || undefined,
    date_to: to || undefined,
    mode: mode || undefined,
    sort_by: sortBy,
    sort_direction: sortDir,
    page,
    page_size: PAYMENT_PAGE_SIZE,
  }
  const { data, isLoading, isError, refetch, isFetching } = useReceivedPayments(filters)
  const items = data?.items ?? []
  const summary = data?.summary
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAYMENT_PAGE_SIZE))

  const clientProjects = (projects ?? []).filter((p) => !clientId || p.client_id === clientId)
  const anyFilter = !!search || status !== 'all' || !!clientId || !!projectId || periodKey !== 'this_fy' || !!mode

  function resetFilters() {
    setSearchInput('')
    setSearch('')
    setStatus('all')
    setClientId('')
    setProjectId('')
    setPeriodKey('this_fy')
    setCustomFrom('')
    setCustomTo('')
    setMode('')
    setPage(1)
  }

  function exportCsv() {
    const csv = toCsv(
      ['Receipt', 'Date', 'Client', 'Project', 'Invoice', 'Amount', 'Mode', 'Reference', 'Status', 'GST', 'Description'],
      items.map((r) => [r.receipt_number ?? '', r.date_received ?? '', r.client_name ?? '', r.project_name ?? '', r.invoice_number ?? '', r.amount, r.mode ?? '', r.reference ?? '', r.status, r.is_gst ? (r.gst_number ?? 'GST') : '', r.description ?? '']),
    )
    downloadCsv(`payments-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  function toggleSort(field: string) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
    setPage(1)
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Record payments on the project when you can; every one shows here with its receipt.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={items.length === 0}>
            <Download /> Export CSV
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Add Payment
          </Button>
        </div>
      </div>

      {summary && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Card><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground sm:text-sm">Received this month</p><p className="mt-1 text-lg font-semibold tabular-nums text-tone-green sm:text-xl">{formatINR(summary.received_this_month)}</p></CardContent></Card>
          <Card><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground sm:text-sm">This financial year</p><p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{formatINR(summary.received_this_fy)}</p></CardContent></Card>
          <Card><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground sm:text-sm">Promised, not yet in</p><p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{formatINR(summary.promised_amount)}</p><p className="hidden text-xs text-muted-foreground sm:block">{summary.pending_count} promised</p></CardContent></Card>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Period">
          {PERIOD_PILLS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={periodKey === k}
              onClick={() => { setPeriodKey(k); setPage(1) }}
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
              <Input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1) }} className="w-40" aria-label="From date" />
              <Input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1) }} className="w-40" aria-label="To date" />
            </>
          )}
          {period && <span className="text-xs text-muted-foreground">{period.label}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search receipt no., client, project, reference…" className="w-full sm:w-64" aria-label="Search payments" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value as PaymentStatusFilter); setPage(1) }} className="w-full sm:w-40" aria-label="Received or promised">
            <option value="all">Received & promised</option>
            <option value="paid">Received</option>
            <option value="pending">Promised</option>
            <option value="gst">With GST</option>
          </Select>
          <Select value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(''); setPage(1) }} className="w-full sm:w-44" aria-label="Filter by client">
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1) }} className="w-full sm:w-52" aria-label="Filter by project">
            <option value="">All projects</option>
            {clientProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Select value={mode} onChange={(e) => { setMode(e.target.value); setPage(1) }} className="w-full sm:w-36" aria-label="Filter by payment mode">
            <option value="">Any mode</option>
            {MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : total === 0 ? (
        anyFilter ? (
          <EmptyState title="No payments match" description="Try clearing the search or status filter." />
        ) : (
          <EmptyState title="Nothing received in this period" description="Record a payment on its project, or add one here." action={<Button onClick={() => setAddOpen(true)}><Plus /> Add Payment</Button>} />
        )
      ) : (
        <>
          {isFetching && <p className="mb-2 text-xs text-muted-foreground">Refreshing…</p>}
          {isMobile ? (
            <RecordCards>
              {items.map((r) => (
                <RecordCard
                  key={r.id}
                  title={formatINR(r.amount)}
                  subtitle={`${r.client_name ?? '—'} · ${r.project_name ?? 'No project'}${r.invoice_number ? ` · ${r.invoice_number}` : ''}`}
                  badge={<StatusBadge tone={PAYMENT_TONE[r.status]}>{r.status === 'paid' ? 'Received' : 'Promised'}</StatusBadge>}
                  fields={[
                    { label: 'Date', value: shortDate(r.date_received) },
                    { label: 'Receipt', value: r.receipt_number ?? '—' },
                    { label: 'GST', value: r.is_gst ? (r.gst_number ?? 'GST') : '—' },
                    ...(r.description ? [{ label: 'Note', value: r.description }] : []),
                  ]}
                  actions={<PaymentRowActions row={r} onView={() => setViewId(r.id)} onEdit={() => setEditTarget(r)} onDelete={() => setDeleteTarget(r)} onEmail={() => setEmailTarget(r)} />}
                />
              ))}
            </RecordCards>
          ) : (
            <div className="table-wrap rounded-lg border border-border">
              <table className="table-sticky w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium"><button type="button" onClick={() => toggleSort('date_received')} className="hover:text-foreground">Date {sortBy === 'date_received' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                    <th className="px-3 py-2 font-medium">Receipt</th>
                    <th className="px-3 py-2 font-medium"><button type="button" onClick={() => toggleSort('client_name')} className="hover:text-foreground">Client {sortBy === 'client_name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                    <th className="px-3 py-2 font-medium"><button type="button" onClick={() => toggleSort('project_name')} className="hover:text-foreground">Project {sortBy === 'project_name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                    <th className="px-3 py-2 text-right font-medium"><button type="button" onClick={() => toggleSort('amount')} className="hover:text-foreground">Amount {sortBy === 'amount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                    <th className="px-3 py-2 font-medium"><button type="button" onClick={() => toggleSort('status')} className="hover:text-foreground">Status {sortBy === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                    <th className="px-3 py-2 font-medium">Invoice</th>
                    <th className="px-3 py-2 font-medium">GST</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{shortDate(r.date_received)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.receipt_number ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2 font-medium">{r.client_name ?? '—'}{r.client_phone && <div className="text-xs font-normal text-muted-foreground">{r.client_phone}</div>}</td>
                      <td className="px-3 py-2">
                        {r.project_id ? (
                          <Link to="/projects/$id" params={{ id: r.project_id }} search={{ tab: 'billing' }} className="text-primary hover:underline">
                            {r.project_name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(r.amount)}{r.mode && <div className="text-xs font-normal text-muted-foreground">{r.mode}</div>}</td>
                      <td className="px-3 py-2"><StatusBadge tone={PAYMENT_TONE[r.status]}>{r.status === 'paid' ? 'Received' : 'Promised'}</StatusBadge></td>
                      <td className="px-3 py-2">
                        {r.invoice_id ? (
                          <Link to="/billing/invoices/$id" params={{ id: r.invoice_id }} className="text-primary hover:underline">
                            {r.invoice_number ?? 'Invoice'}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.is_gst ? (<span className="inline-flex items-center gap-1 text-xs"><Receipt className="size-3" /> {r.gst_number ?? 'GST'}</span>) : '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <PaymentRowActions row={r} onView={() => setViewId(r.id)} onEdit={() => setEditTarget(r)} onDelete={() => setDeleteTarget(r)} onEmail={() => setEmailTarget(r)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Page {page} of {totalPages} · {total} total</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft /> Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}

      <ReceivedPaymentDialog open={addOpen} onOpenChange={setAddOpen} initial={null} />
      <ReceivedPaymentDialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)} initial={editTarget} />
      <ViewReceivedPaymentDialog paymentId={viewId} onOpenChange={(v) => !v && setViewId(null)} onEdit={(p) => { setViewId(null); setEditTarget(p) }} />
      <DeleteReceivedPaymentDialog payment={deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)} />
      <SendReceiptDialog open={!!emailTarget} onOpenChange={(v) => !v && setEmailTarget(null)} payment={emailTarget} />
    </>
  )
}

function PaymentRowActions({ row, onView, onEdit, onDelete, onEmail }: { row: ReceivedPayment; onView: () => void; onEdit: () => void; onDelete: () => void; onEmail: () => void }) {
  async function onCopy() {
    await copyReceiptLink(row.id)
  }

  async function onWhatsApp() {
    const link = (await issueReceiptLink(row.id)) ?? row.file_url ?? window.location.href
    openReceiptWhatsApp(
      row.client_phone,
      receiptShareText(
        { clientName: row.client_name, projectName: row.project_name, amountFormatted: formatINR(row.amount), paymentDate: row.date_received ?? '' },
        link,
      ),
    )
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={onView} title="View receipt" aria-label="View receipt">
        <Eye />
      </Button>
      <RowMenu
        label={`More for the ${formatINR(row.amount)} payment`}
        items={[
          { label: 'Edit', icon: <Pencil className="size-4" />, onSelect: onEdit },
          ...(row.status === 'paid'
            ? [
                { label: 'Send receipt on WhatsApp', icon: <MessageCircle className="size-4" />, onSelect: () => void onWhatsApp() },
                { label: 'Email receipt', icon: <Mail className="size-4" />, onSelect: onEmail },
                { label: 'Copy receipt link', icon: <Copy className="size-4" />, onSelect: () => void onCopy() },
              ]
            : []),
          { label: 'Delete', icon: <Trash2 className="size-4" />, onSelect: onDelete },
        ]}
      />
    </>
  )
}
