import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, IndianRupee, Download, ChevronLeft, ChevronRight, Eye, Pencil, Trash2, Copy, Mail, MessageCircle, Landmark, Receipt, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { buildMailtoUrl, friendlyInvoiceError, type ReceivedPayment } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { HowToUse } from '@/shared/ui/how-to-use'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatINR, humanize } from '@/shared/ui/format'
import { Card, CardContent } from '@/shared/ui/card'
import { BarChart, ShareChart } from '@/shared/ui/chart'
import { monthlySeries } from '@/shared/ui/chart-geometry'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import {
  useInvoices,
  useStates,
  useCreateInvoice,
  useRecordPayment,
  useReceivedPayments,
  useSetPaymentCleared,
  type ReceivedPaymentFilters,
} from '@/features/billing/api'
import { emptyInvoiceForm, useInvoiceForm, InvoiceFormFields } from '@/features/billing/InvoiceForm'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import { useClients } from '@/features/clients/api'
import { useProjects } from '@/features/projects/api'
import {
  ReceivedPaymentDialog,
  ViewReceivedPaymentDialog,
  DeleteReceivedPaymentDialog,
} from '@/features/billing/ReceivedPaymentDialogs'
import { SendReceiptDialog } from '@/features/billing/SendReceiptDialog'
import { copyReceiptLink, openReceiptWhatsApp, receiptShareText, issueReceiptLink } from '@/features/billing/receiptShare'

const TONE = { draft: 'neutral', sent: 'info', partial: 'warning', paid: 'success', cancelled: 'danger' } as const
const PAGE_SIZE = 25

type StatusFilter = 'all' | 'paid' | 'pending' | 'partial' | 'overdue' | 'draft' | 'sent' | 'cancelled'

export function BillingPage({ newInvoice }: { newInvoice?: boolean } = {}) {
  return (
    <AuthedPage module="billing">
      <Billing newInvoice={newInvoice} />
    </AuthedPage>
  )
}

function Billing({ newInvoice }: { newInvoice?: boolean | undefined }) {
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices')
  return (
    <>
      <PageHeader
        title="Billing"
        description="GST invoices and payments."
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Everything printed on a client document — the studio's contact
                block, bank accounts, note and terms templates — lives on its
                own page. It was only reachable from a link buried inside the
                invoice form, so most studios never found it. */}
            <Button variant="outline" asChild>
              <Link to="/billing/templates">
                <Settings2 /> Invoice settings
              </Link>
            </Button>
            <NewInvoiceDialog autoOpen={newInvoice} />
          </div>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'invoices' | 'payments')}>
        <TabsList className="mb-4">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices">
          <InvoicesSection />
        </TabsContent>
        <TabsContent value="payments">
          <HowToUse
            className="mb-4"
            title="Track client payments"
            description="Money actually received, what is still pending, and the balance on each project."
            steps={[
              'Add the payment details as they come in.',
              'Link the payment to its project or client.',
              'Watch the pending balance close.',
            ]}
          />
          <PaymentsSection />
        </TabsContent>
      </Tabs>
    </>
  )
}

function InvoicesSection() {
  const isMobile = useIsMobile()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const { data: clientsData } = useClients()
  const clients = Array.isArray(clientsData) ? clientsData : (clientsData?.items ?? [])
  const { data: projects } = useProjects()

  // Debounce the search box so every keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data, isLoading, isError, refetch, isFetching } = useInvoices({
    search,
    status,
    client_id: clientId || undefined,
    project_id: projectId || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    page_size: PAGE_SIZE,
  })

  const items = data?.items ?? []
  const summary = data?.summary
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const totalBilled = summary?.billed ?? 0
  const totalPaid = summary?.paid ?? 0
  const totalPending = summary?.pending ?? 0
  const totalInvoices = summary?.total_invoices ?? 0

  const clientProjects = (projects ?? []).filter((p) => !clientId || p.client_id === clientId)
  const anyFilter = !!search || status !== 'all' || !!clientId || !!projectId || !!from || !!to

  function resetFilters() {
    setSearchInput('')
    setSearch('')
    setStatus('all')
    setClientId('')
    setProjectId('')
    setFrom('')
    setTo('')
    setPage(1)
  }

  function exportCsv() {
    const csv = toCsv(
      ['Number', 'Client', 'Date', 'Total', 'Balance', 'Status'],
      items.map((inv) => [inv.invoice_number, inv.client_name ?? '', inv.invoice_date, inv.total, inv.balance_due, inv.status]),
    )
    downloadCsv(`invoices-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  // Charts reflect the current filtered page set; the summary line above is
  // server-computed over the whole filtered set, not just this page.
  const chartRows = items

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search number or client…"
          className="w-64"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter)
            setPage(1)
          }}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending (any balance)</option>
          <option value="partial">Partial</option>
          <option value="overdue">Overdue balance</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value)
            setProjectId('')
            setPage(1)
          }}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm"
          aria-label="Filter by client"
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value)
            setPage(1)
          }}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm"
          aria-label="Filter by project"
          disabled={!clientId}
        >
          <option value="">All projects</option>
          {clientProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="w-40" aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="w-40" aria-label="To date" />
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Clear
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={items.length === 0}>
          <Download /> Export CSV
        </Button>
        <span className="text-sm text-muted-foreground">
          {totalInvoices} invoice{totalInvoices === 1 ? '' : 's'} · Billed {formatINR(totalBilled)} · Paid{' '}
          {formatINR(totalPaid)} · Pending {formatINR(totalPending)}
          {isFetching ? ' · Refreshing…' : ''}
        </span>
      </div>
      {isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || total === 0 ? (
        anyFilter ? (
          <EmptyState title="No invoices match" description="Try clearing the search or status filter." />
        ) : (
          <EmptyState title="No invoices yet" description="Raise your first GST invoice." action={<NewInvoiceDialog />} />
        )
      ) : (
        <>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold tracking-tight">Invoiced by month</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">The last six months.</p>
              <BarChart
                className="mt-4"
                points={monthlySeries(chartRows, (i) => i.invoice_date, (i) => i.total)}
                format={formatINR}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold tracking-tight">Collected against outstanding</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Across the filtered set, not just this page.
              </p>
              <ShareChart
                className="mt-4"
                points={[
                  { label: 'Received', value: totalPaid },
                  { label: 'Outstanding', value: totalPending },
                ]}
                format={formatINR}
              />
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
        {isMobile ? (
          <RecordCards>
            {items.map((inv) => (
              <RecordCard
                key={inv.id}
                title={
                  <Link to="/billing/invoices/$id" params={{ id: inv.id }} className="hover:underline">
                    {inv.invoice_number}
                  </Link>
                }
                subtitle={`${inv.client_name ?? '—'} · ${inv.invoice_date}`}
                badge={<StatusBadge tone={TONE[inv.status]}>{humanize(inv.status)}</StatusBadge>}
                fields={[
                  { label: 'Total', value: formatINR(inv.total) },
                  { label: 'Balance', value: formatINR(inv.balance_due), strong: true },
                ]}
                actions={
                  <div className="flex flex-wrap gap-2">
                    {inv.balance_due > 0 && <PaymentDialog invoiceId={inv.id} balance={inv.balance_due} />}
                    <InvoiceRowShare invoiceId={inv.id} invoiceNumber={inv.invoice_number} total={inv.total} balance={inv.balance_due} />
                  </div>
                }
              />
            ))}
          </RecordCards>
        ) : (
        <div className="table-wrap rounded-lg border border-border">
          <table className="table-sticky w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-right font-medium">Balance</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((inv) => (
                <tr key={inv.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">
                    <Link to="/billing/invoices/$id" params={{ id: inv.id }} className="hover:underline">
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{inv.client_name ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{inv.invoice_date}</td>
                  <td className="px-4 py-2 text-right">{formatINR(inv.total)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatINR(inv.balance_due)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge tone={TONE[inv.status]}>{humanize(inv.status)}</StatusBadge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      {inv.balance_due > 0 && <PaymentDialog invoiceId={inv.id} balance={inv.balance_due} />}
                      <InvoiceRowShare invoiceId={inv.id} invoiceNumber={inv.invoice_number} total={inv.total} balance={inv.balance_due} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} · {total} total
          </p>
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
    </>
  )
}

function NewInvoiceDialog({ autoOpen }: { autoOpen?: boolean | undefined } = {}) {
  const create = useCreateInvoice()
  const { data: states } = useStates()
  // /billing/invoices/new was its own page in the old app; landing on that
  // link should still put the form in front of you.
  const [open, setOpen] = useState(autoOpen ?? false)
  const form = useInvoiceForm(emptyInvoiceForm())
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    // Everything the invoice is missing, said out loud. The Create button used
    // to be disabled instead — on a total that ignored any line without a
    // description, so a fresh form could never be submitted and nothing on
    // screen explained why.
    const problems = form.problems()
    if (problems.length > 0) {
      setError(problems[0] ?? 'This invoice is not ready yet.')
      return
    }
    const discount = Number(form.values.discount) || 0
    if (form.values.discount_type === 'percent' && discount > 100) {
      setError('Discount percentage cannot exceed 100%.')
      return
    }
    if (form.values.discount_type === 'flat' && discount > form.totals.subtotal && form.totals.subtotal > 0) {
      setError('Discount cannot exceed the invoice subtotal.')
      return
    }
    // Lovable parity gates (mirrors the server): GSTIN format, place of
    // supply when tax applies, and at least one taxed line on GST invoices.
    if (!form.values.no_gst) {
      const gst = form.values.gst_number.trim().toUpperCase()
      if (gst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst)) {
        setError('GSTIN format looks invalid. Expected 15-char GSTIN like 27ABCDE1234F1Z5.')
        return
      }
      if (!form.values.place_of_supply.trim()) {
        setError('Place of Supply is required for GST invoices.')
        return
      }
      const hasTax = form.values.lines.some((l) => Number(l.gst_rate) > 0)
      if (gst && !hasTax) {
        setError('At least one item must have a tax rate for GST invoices.')
        return
      }
    }
    try {
      await create.mutateAsync(form.toRequest())
      setOpen(false)
      form.reset()
    } catch (err) {
      setError(friendlyInvoiceError(err))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Cancelling used to keep the half-typed invoice for next time.
        if (!next) {
          form.reset()
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New invoice
        </Button>
      </DialogTrigger>
      <DialogContent title="New invoice" description="GST is computed automatically." className="max-w-2xl">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <InvoiceFormFields form={form} states={states} />
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            {/* Enabled, so submitting can explain what is missing. */}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create invoice'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PaymentDialog({ invoiceId, balance }: { invoiceId: string; balance: number }) {
  const record = useRecordPayment(invoiceId)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(balance))
  const [mode, setMode] = useState('')
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const value = Number(amount) || 0
    if (value <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (value > balance) {
      const yes = window.confirm(
        `This payment (₹${value}) is more than the balance due (₹${balance}). Record it anyway?`,
      )
      if (!yes) return
    }
    try {
      await record.mutateAsync({
        amount: value,
        ...(paidOn ? { paid_on: paidOn } : {}),
        ...(mode ? { mode } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      setOpen(false)
      setNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record payment.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <IndianRupee /> Record
        </Button>
      </DialogTrigger>
      <DialogContent title="Record payment" description={`Balance due ${formatINR(balance)}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Amount</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Payment date</Label>
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Reference (optional)</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="UTR / txn id — recommended for UPI & bank transfer"
              />
            </div>
          </div>
          <PaymentModePicker value={mode} onChange={setMode} />
          <div className="flex flex-col gap-1.5">
            <Label>Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Part payment via UPI, balance next week"
            />
          </div>
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Per-row invoice share (Lovable parity): copy link + WhatsApp. */
function InvoiceRowShare({ invoiceId, invoiceNumber, total, balance }: { invoiceId: string; invoiceNumber: string; total: number; balance: number }) {
  const link = typeof window !== 'undefined' ? `${window.location.origin}/billing/invoices/${invoiceId}` : ''

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Invoice link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  function onWhatsApp() {
    const text = `Invoice ${invoiceNumber} for ${formatINR(total)}. Balance ${formatINR(balance)}. View: ${link}`
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) {
      void navigator.clipboard.writeText(text).then(
        () => toast.success('Message copied — paste into WhatsApp.'),
        () => toast.error('Unable to open WhatsApp.'),
      )
    }
  }

  function onEmail() {
    const subject = `Invoice ${invoiceNumber} — ${formatINR(total)}`
    const body = `Please find your invoice ${invoiceNumber} for ${formatINR(total)} (balance ${formatINR(balance)}).\nView it here: ${link}`
    window.location.href = buildMailtoUrl(null, subject, body)
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => void onCopy()} title="Copy invoice link" aria-label="Copy invoice link">
        <Copy />
      </Button>
      <Button size="sm" variant="ghost" onClick={onEmail} title="Share invoice by email" aria-label="Share invoice by email">
        <Mail />
      </Button>
      <Button size="sm" variant="ghost" onClick={onWhatsApp} title="Share invoice on WhatsApp" aria-label="Share invoice on WhatsApp">
        <MessageCircle />
      </Button>
    </>
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
  const [status, setStatus] = useState<PaymentStatusFilter>('all')
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState('')
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
        <p className="text-sm text-muted-foreground">Track client payments, pending balances and GST receipts per project.</p>
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
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total Received</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(summary?.total_received_amount ?? 0)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Pending Amount</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(summary?.pending_amount ?? 0)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Paid Payments</p><p className="mt-1 text-xl font-semibold tabular-nums">{summary?.paid_count ?? 0}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Pending Payments</p><p className="mt-1 text-xl font-semibold tabular-nums">{summary?.pending_count ?? 0}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">GST Payments</p><p className="mt-1 text-xl font-semibold tabular-nums">{summary?.gst_count ?? 0}</p></CardContent></Card>
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
          <select value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(''); setPage(1) }} className="h-9 rounded-md border border-input bg-card px-3 text-sm" aria-label="Filter by client">
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1) }} className="h-9 rounded-md border border-input bg-card px-3 text-sm" aria-label="Filter by project" disabled={!clientId && (projects ?? []).length === 0}>
            <option value="">All projects</option>
            {clientProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
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
                  subtitle={`${r.client_name ?? '—'} · ${r.project_name ?? 'No project'} · ${r.date_received ?? ''}`}
                  badge={<StatusBadge tone={PAYMENT_TONE[r.status]}>{humanize(r.status)}</StatusBadge>}
                  fields={[
                    { label: 'Date', value: r.date_received ?? '—' },
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
                    <th className="px-3 py-2 font-medium">GST</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.date_received ?? '—'}</td>
                      <td className="px-3 py-2 font-medium">{r.client_name ?? '—'}{r.client_phone && <div className="text-xs font-normal text-muted-foreground">{r.client_phone}</div>}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.project_name ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(r.amount)}</td>
                      <td className="px-3 py-2"><StatusBadge tone={PAYMENT_TONE[r.status]}>{humanize(r.status)}</StatusBadge></td>
                      <td className="px-3 py-2"><BankedCell row={r} /></td>
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
      <Button size="sm" variant="ghost" onClick={onEdit} title="Edit payment" aria-label="Edit payment">
        <Pencil />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void onCopy()} title="Copy public link" aria-label="Copy public link">
        <Copy />
      </Button>
      <Button size="sm" variant="ghost" onClick={onEmail} title="Email receipt" aria-label="Email receipt">
        <Mail />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void onWhatsApp()} title="WhatsApp receipt" aria-label="WhatsApp receipt">
        <MessageCircle />
      </Button>
      <Button size="sm" variant="ghost" onClick={onDelete} title="Delete payment" aria-label="Delete payment" className="text-destructive">
        <Trash2 />
      </Button>
    </>
  )
}
