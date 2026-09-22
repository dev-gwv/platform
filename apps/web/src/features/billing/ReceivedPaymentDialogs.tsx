import { useEffect, useState, type FormEvent } from 'react'
import { Copy, Mail, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { buildMailtoUrl } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR, humanize } from '@/shared/ui/format'
import { useClients } from '@/features/clients/api'
import { useProjects } from '@/features/projects/api'
import {
  useCreateReceivedPayment,
  useReceivedPayment,
  useUpdateReceivedPayment,
  useDeleteReceivedPayment,
  type ReceivedPayment,
  useInvoices,
} from './api'
import { SendReceiptDialog } from './SendReceiptDialog'
import { copyReceiptLink, issueReceiptLink, openReceiptWhatsApp, receiptShareText } from './receiptShare'

const todayISO = () => new Date().toISOString().slice(0, 10)

interface PaymentFormState {
  project_id: string
  invoice_id: string
  client_id: string
  amount: string
  description: string
  status: 'paid' | 'pending'
  is_gst: boolean
  gst_number: string
  date_received: string
  file_url: string
}

const emptyForm = (): PaymentFormState => ({
  project_id: '',
  invoice_id: '',
  client_id: '',
  amount: '',
  description: '',
  status: 'paid',
  is_gst: false,
  gst_number: '',
  date_received: todayISO(),
  file_url: '',
})

function toForm(p: ReceivedPayment): PaymentFormState {
  return {
    project_id: p.project_id ?? '',
    invoice_id: p.invoice_id ?? '',
    client_id: p.client_id ?? '',
    amount: String(p.amount ?? ''),
    description: p.description ?? '',
    status: p.status,
    is_gst: !!p.is_gst,
    gst_number: p.gst_number ?? '',
    date_received: p.date_received ?? todayISO(),
    file_url: p.file_url ?? '',
  }
}

/** Add / Edit dialog for a standalone received payment (Lovable BillingPaymentDialog parity). */
export function ReceivedPaymentDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: ReceivedPayment | null
}) {
  const isEdit = !!initial
  const create = useCreateReceivedPayment()
  const update = useUpdateReceivedPayment(initial?.id ?? '')
  const { data: clientsData } = useClients()
  const clients = Array.isArray(clientsData) ? clientsData : (clientsData?.items ?? [])
  const { data: projects } = useProjects()
  const [form, setForm] = useState<PaymentFormState>(emptyForm())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(initial ? toForm(initial) : emptyForm())
      setError(null)
    }
  }, [open, initial])

  const { data: invoices } = useInvoices()
  const pending = create.isPending || update.isPending
  const clientProjects = (projects ?? []).filter((p) => !form.client_id || p.client_id === form.client_id)
  // The list endpoint answers with either an array or a page, depending on
  // whether it was asked for one; the client's name is all it carries, so the
  // list is narrowed by that rather than by id.
  const invoiceRows = Array.isArray(invoices) ? invoices : (invoices?.items ?? [])
  const clientName = clients.find((c) => c.id === form.client_id)?.name ?? null
  const openInvoices = invoiceRows.filter(
    (i) => i.status !== 'cancelled' && (!clientName || i.client_name === clientName),
  )

  function set<K extends keyof PaymentFormState>(key: K, value: PaymentFormState[K]) {
    setForm((s) => ({ ...s, [key]: value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    // Since 0145 a payment may be against an invoice instead of a project —
    // an invoice need not belong to one. It must be against something, or
    // nothing can ever reconcile it.
    if (!form.project_id && !form.invoice_id) {
      setError('Pick the project or the invoice this payment is against.')
      return
    }
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be greater than zero.')
      return
    }
    if (form.is_gst && form.gst_number.trim().length < 5) {
      setError('Invalid GST number.')
      return
    }
    const payload = {
      ...(form.project_id ? { project_id: form.project_id } : {}),
      ...(form.invoice_id ? { invoice_id: form.invoice_id } : {}),
      ...(form.client_id ? { client_id: form.client_id } : {}),
      amount,
      description: form.description.trim() || null,
      status: form.status,
      is_gst: form.is_gst,
      gst_number: form.is_gst ? form.gst_number.trim() || null : null,
      ...(form.date_received ? { date_received: form.date_received } : {}),
      file_url: form.file_url.trim() || null,
    }
    try {
      if (isEdit && initial) {
        await update.mutateAsync(payload)
      } else {
        await create.mutateAsync(payload)
      }
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the payment.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isEdit ? 'Edit payment' : 'Add payment'} description="Record a received payment. Linked to a project; appears in billing and project totals.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Client (optional)</Label>
              <select
                value={form.client_id}
                onChange={(e) => {
                  set('client_id', e.target.value)
                  set('project_id', '')
                }}
                className="h-9 rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <select
                value={form.project_id}
                onChange={(e) => set('project_id', e.target.value)}
                className="h-9 rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="">Select project</option>
                {clientProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              {/* Naming the invoice is what settles it. Before 0145 the two
                  were separate ledgers, so a payment recorded here left the
                  invoice reading unpaid however much the client had sent. */}
              <Label>Against invoice</Label>
              <select
                value={form.invoice_id}
                onChange={(e) => set('invoice_id', e.target.value)}
                className="h-9 rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="">Not against an invoice</option>
                {openInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number} · {formatINR(i.total)}
                    {Number(i.balance_due) > 0 ? ` · ${formatINR(Number(i.balance_due))} due` : ' · settled'}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Pick one and the invoice settles itself from this payment.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>
                Amount (₹) <span className="text-destructive">*</span>
              </Label>
              <Input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value as 'paid' | 'pending')}
                className="h-9 rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Date received</Label>
              <Input type="date" value={form.date_received} onChange={(e) => set('date_received', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Receipt URL (optional)</Label>
              <Input value={form.file_url} onChange={(e) => set('file_url', e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description (optional)</Label>
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Note for this payment…" />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_gst} onChange={(e) => set('is_gst', e.target.checked)} />
              GST applicable
            </label>
            {form.is_gst && (
              <div className="mt-2 flex flex-col gap-1.5">
                <Label>GST number</Label>
                <Input value={form.gst_number} onChange={(e) => set('gst_number', e.target.value)} placeholder="e.g. 27ABCDE1234F1Z5" />
                <p className="text-xs text-muted-foreground">15-char format like 27ABCDE1234F1Z5.</p>
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add payment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Read-only view with Copy link / Email / WhatsApp share (Lovable InvoiceActions parity). */
export function ViewReceivedPaymentDialog({
  paymentId,
  onOpenChange,
  onEdit,
}: {
  paymentId: string | null
  onOpenChange: (open: boolean) => void
  onEdit?: (p: ReceivedPayment) => void
}) {
  const { data } = useReceivedPayment(paymentId)
  const [emailOpen, setEmailOpen] = useState(false)

  async function onCopy() {
    if (!paymentId) return
    await copyReceiptLink(paymentId)
  }

  async function onWhatsApp() {
    if (!data) return
    const link = (await issueReceiptLink(data.id)) ?? data.file_url ?? window.location.href
    openReceiptWhatsApp(
      data.client_phone,
      receiptShareText(
        {
          clientName: data.client_name,
          projectName: data.project_name,
          amountFormatted: formatINR(data.amount),
          paymentDate: data.date_received ?? '',
        },
        link,
      ),
    )
  }

  function onMailto() {
    if (!data) return
    const subject = `Payment Receipt - ${formatINR(data.amount)}`
    const body = `Hi ${data.client_name || 'there'}, here is your payment receipt of ${formatINR(data.amount)}.`
    window.location.href = buildMailtoUrl(data.client_email, subject, body)
  }

  return (
    <>
      <Dialog open={!!paymentId} onOpenChange={onOpenChange}>
        <DialogContent title="Payment receipt" description={data ? `${data.client_name ?? '—'} · ${data.date_received ?? ''}` : undefined}>
          {!data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xl font-semibold tabular-nums">{formatINR(data.amount)}</p>
                  <p className="text-sm text-muted-foreground">
                    {data.project_name ?? '—'}
                    {data.description ? ` · ${data.description}` : ''}
                  </p>
                </div>
                <StatusBadge tone={data.status === 'paid' ? 'success' : 'warning'}>{humanize(data.status)}</StatusBadge>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Client</dt>
                  <dd>{data.client_name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Date</dt>
                  <dd>{data.date_received ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">GST</dt>
                  <dd>{data.is_gst ? (data.gst_number ?? 'GST') : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Receipt file</dt>
                  <dd className="truncate">{data.file_url ? <a href={data.file_url} target="_blank" rel="noreferrer" className="underline">Open</a> : '—'}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void onCopy()}>
                  <Copy className="mr-1 size-4" /> Copy link
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEmailOpen(true)}>
                  <Mail className="mr-1 size-4" /> Email
                </Button>
                <Button size="sm" variant="outline" onClick={() => void onWhatsApp()}>
                  <MessageCircle className="mr-1 size-4" /> WhatsApp
                </Button>
                <Button size="sm" variant="outline" onClick={onMailto}>
                  Email app
                </Button>
                {onEdit && (
                  <Button size="sm" variant="outline" onClick={() => onEdit(data)}>
                    Edit
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <SendReceiptDialog open={emailOpen} onOpenChange={setEmailOpen} payment={data ?? null} />
    </>
  )
}

export function DeleteReceivedPaymentDialog({
  payment,
  onOpenChange,
}: {
  payment: ReceivedPayment | null
  onOpenChange: (open: boolean) => void
}) {
  const del = useDeleteReceivedPayment()

  async function onConfirm() {
    if (!payment) return
    try {
      await del.mutateAsync(payment.id)
      onOpenChange(false)
    } catch {
      toast.error('Could not delete the payment.')
    }
  }

  return (
    <Dialog open={!!payment} onOpenChange={onOpenChange}>
      <DialogContent title="Delete payment?" description="This permanently removes the payment record. Project totals refresh automatically.">
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={del.isPending}>
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
