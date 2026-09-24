import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, Download, ChevronLeft, ChevronRight, Eye, Pencil, Trash2, Copy, Mail, MessageCircle, Landmark, Receipt } from 'lucide-react'
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
import { formatINR, humanize } from '@/shared/ui/format'
import { Card, CardContent } from '@/shared/ui/card'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { useReceivedPayments, useSetPaymentCleared, type ReceivedPaymentFilters } from '@/features/billing/api'
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
      <PageHeader title="Payments" description="Money received and promised, with the project and invoice each one belongs to." />
      <PaymentsSection />
    </AuthedPage>
  )
}

const PAYMENT_PAGE_SIZE = 25
type PaymentStatusFilter = 'all' | 'paid' | 'pending' | 'gst'

const PAYMENT_TONE = { paid: 'success', pending: 'warning' } as const

/** Standalone received-payments tab (Lovable billing parity). Invoices stay untouched above. */
/**
 * Whether this money has been confirmed as reaching the bank.
 *
 * A separate fact from "paid": paid is what the studio recorded, banked is
 * what somebody checked against the account. Keeping them apart is what lets
 * the reconciliation screen show a payment that never actually arrived.
 * Only a paid row can be banked — there is nothing to confirm about a promise.
 */
function BankedCell({ row }: { row: ReceivedPayment }) {
  const set = useSetPaymentCleared()
  if (row.status !== 'paid') return <span className="text-xs text-muted-foreground">—</span>
  const banked = !!row.cleared_at
  return (
    <button
      type="button"
      disabled={set.isPending}
      onClick={() => set.mutate({ id: row.id, cleared: !banked })}
      className="inline-flex items-center gap-1.5 text-xs disabled:opacity-60"
      title={banked ? 'Confirmed in the bank — click to undo' : 'Mark as reaching the bank'}
    >
      <StatusBadge tone={banked ? 'success' : 'neutral'}>
        {banked ? <><Landmark className="size-3" /> Banked</> : 'Not confirmed'}
      </StatusBadge>
    </button>
  )
}

function PaymentsSection() {
  const isMobile = useIsMobile()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusParam, setStatusParam] = useUrlParam('status', 'all')
  const status = (['all', 'paid', 'pending', 'gst'].includes(statusParam) ? statusParam : 'all') as PaymentStatusFilter
  const setStatus = (v: PaymentStatusFilter) => setStatusParam(v)
  const [clientId, setClientId] = useUrlParam('client')
  const [projectId, setProjectId] = useUrlParam('project')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
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
    amount_min: min.trim() !== '' && Number.isFinite(Number(min)) ? Number(min) : undefined,
    amount_max: max.trim() !== '' && Number.isFinite(Number(max)) ? Number(max) : undefined,
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
  const anyFilter = !!search || status !== 'all' || !!clientId || !!projectId || !!from || !!to || !!min.trim() || !!max.trim()

  function resetFilters() {
    setSearchInput('')
    setSearch('')
    setStatus('all')
    setClientId('')
    setProjectId('')
    setFrom('')
    setTo('')
    setMin('')
    setMax('')
    setPage(1)
  }

  function exportCsv() {
    const csv = toCsv(
      ['Date', 'Client', 'Project', 'Amount', 'Status', 'GST', 'Description'],
      items.map((r) => [r.date_received ?? '', r.client_name ?? '', r.project_name ?? '', r.amount, r.status, r.is_gst ? (r.gst_number ?? 'GST') : '', r.description ?? '']),
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
        <p className="text-sm text-muted-foreground">Most payments are recorded on the project; they all show here.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={items.length === 0}>
            <Download /> Export CSV
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Add Payment
          </Button>
        </div>
      </div>

      {(summary || items.length > 0) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Received</p><p className="mt-1 text-xl font-semibold tabular-nums text-tone-green">{formatINR(summary?.total_received_amount ?? 0)}</p><p className="text-xs text-muted-foreground">{summary?.paid_count ?? 0} payment{summary?.paid_count === 1 ? '' : 's'}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Promised, not yet in</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(summary?.pending_amount ?? 0)}</p><p className="text-xs text-muted-foreground">{summary?.pending_count ?? 0} promised</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">GST receipts</p><p className="mt-1 text-xl font-semibold tabular-nums">{summary?.gst_count ?? 0}</p><p className="text-xs text-muted-foreground">Payments marked with a GST number</p></CardContent></Card>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search client, project, description, GST number…" className="flex-1" />
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(['all', 'paid', 'pending', 'gst'] as PaymentStatusFilter[]).map((s) => (
            <Button key={s} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => { setStatus(s); setPage(1) }}>
              {s === 'all' ? 'All' : s === 'gst' ? 'GST' : humanize(s)}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(''); setPage(1) }} aria-label="Filter by client">
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1) }} aria-label="Filter by project">
            <option value="">All projects</option>
            {clientProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} aria-label="To date" />
          <Input inputMode="decimal" value={min} onChange={(e) => { setMin(e.target.value); setPage(1) }} placeholder="Min amount" aria-label="Min amount" />
          <Input inputMode="decimal" value={max} onChange={(e) => { setMax(e.target.value); setPage(1) }} placeholder="Max amount" aria-label="Max amount" />
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
          <EmptyState title="No payments yet" description="Record your first received payment." action={<Button onClick={() => setAddOpen(true)}><Plus /> Add Payment</Button>} />
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
                  badge={<StatusBadge tone={PAYMENT_TONE[r.status]}>{humanize(r.status)}</StatusBadge>}
                  fields={[
                    { label: 'Date', value: shortDate(r.date_received) },
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
                    <th className="px-3 py-2 font-medium"><button type="button" onClick={() => toggleSort('client_name')} className="hover:text-foreground">Client {sortBy === 'client_name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                    <th className="px-3 py-2 font-medium"><button type="button" onClick={() => toggleSort('project_name')} className="hover:text-foreground">Project {sortBy === 'project_name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                    <th className="px-3 py-2 text-right font-medium"><button type="button" onClick={() => toggleSort('amount')} className="hover:text-foreground">Amount {sortBy === 'amount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                    <th className="px-3 py-2 font-medium"><button type="button" onClick={() => toggleSort('status')} className="hover:text-foreground">Status {sortBy === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                    <th className="px-3 py-2 font-medium">Banked</th>
                    <th className="px-3 py-2 font-medium">Invoice</th>
                    <th className="px-3 py-2 font-medium">GST</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{shortDate(r.date_received)}</td>
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
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(r.amount)}</td>
                      <td className="px-3 py-2"><StatusBadge tone={PAYMENT_TONE[r.status]}>{humanize(r.status)}</StatusBadge></td>
                      <td className="px-3 py-2"><BankedCell row={r} /></td>
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
