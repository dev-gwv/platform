import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Printer, ArrowLeft, Pencil, Trash2, Copy, Mail, MessageCircle, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { amountInWords } from '@ipc/domain'
import { buildMailtoUrl, buildWhatsAppUrl, companyProfile, friendlyInvoiceError, type InvoiceDetail } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState } from '@/shared/ui/states'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { useConfirm } from '@/shared/ui/confirm'
import { formatINR, humanize } from '@/shared/ui/format'
import { useInvoice, useUpdateInvoice, useDeleteInvoice, useStates, useRecordPayment } from '@/features/billing/api'
import { useInvoiceForm, InvoiceFormFields } from '@/features/billing/InvoiceForm'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import { DateField } from '@/shared/ui/date-field'

const TONE = { draft: 'neutral', sent: 'info', partial: 'warning', paid: 'success', cancelled: 'danger' } as const

export function InvoiceDetailPage({ edit }: { edit?: boolean } = {}) {
  return (
    <AuthedPage module="billing">
      <InvoiceDoc edit={edit} />
    </AuthedPage>
  )
}

function InvoiceDoc({ edit }: { edit?: boolean | undefined }) {
  const { id } = useParams({ from: '/authed/billing/invoices/$id' })
  const { data, isLoading, isError, refetch } = useInvoice(id)
  const { data: company } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })

  if (isLoading) return <SkeletonCards count={3} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const intraState = data.intra_state
  const editable = data.amount_paid === 0 && data.status !== 'cancelled'
  // No template resolved (none picked, no company default) prints exactly as
  // it always did — every layout field defaults to "show it".
  const layout = data.template_layout ?? {
    show_header: true,
    show_footer: true,
    show_gst: true,
    show_bank_details: false,
    header_text: null,
    footer_text: null,
    bank_details: null,
    terms_and_conditions: null,
  }

  return (
    <>
      <div className="paper-toolbar mb-4 flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link to="/billing">
            <ArrowLeft /> Back
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <>
              <EditInvoiceDialog invoice={data} autoOpen={edit} />
              <DeleteInvoiceButton invoiceId={data.id} />
            </>
          )}
          {data.balance_due > 0 && <DetailRecordPayment invoiceId={data.id} balance={data.balance_due} />}
          <InvoiceShareActions invoice={data} />
          <DownloadDocumentButton
            name={`Invoice ${data.invoice_number}${data.client_name ? ` ${data.client_name}` : ''}`}
            label="Download PDF"
          />
          <Button size="sm" onClick={() => window.print()}>
            <Printer /> Print Invoice
          </Button>
        </div>
      </div>

      <div className="paper mx-auto max-w-3xl rounded-lg border border-border bg-card p-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          {layout.show_header ? (
            <div>
              <h1 className="text-xl font-bold">{company?.name ?? 'Your Studio'}</h1>
              {company?.city && (
                <p className="text-sm text-muted-foreground">
                  {[company.city, company.state, company.country].filter(Boolean).join(', ')}
                </p>
              )}
              {company?.invoice_gst_number && (
                <p className="text-sm text-muted-foreground">GSTIN: {company.invoice_gst_number}</p>
              )}
              {layout.header_text && <p className="mt-1 text-sm text-muted-foreground">{layout.header_text}</p>}
            </div>
          ) : (
            <div />
          )}
          <div className="text-right">
            <p className="text-lg font-semibold">TAX INVOICE</p>
            <p className="text-sm">{data.invoice_number}</p>
            <p className="text-sm text-muted-foreground">{data.invoice_date}</p>
            {data.due_date && <p className="text-xs text-muted-foreground">Due {data.due_date}</p>}
            <StatusBadge tone={TONE[data.status]}>{humanize(data.status)}</StatusBadge>
          </div>
        </div>

        {/* Bill to */}
        <div className="py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Bill to</p>
          <p className="font-medium">{data.client_name ?? '—'}</p>
          {data.client_address && <p className="text-sm text-muted-foreground">{data.client_address}</p>}
          {(data.client_phone || data.client_email) && (
            <p className="text-sm text-muted-foreground">
              {[data.client_phone, data.client_email].filter(Boolean).join(' · ')}
            </p>
          )}
          {data.client_gstin && <p className="text-sm text-muted-foreground">GSTIN {data.client_gstin}</p>}
          {data.gst_number && <p className="text-sm text-muted-foreground">Invoice GSTIN: {data.gst_number}</p>}
          {data.project_name && (
            <p className="mt-1 text-sm text-muted-foreground">Project: {data.project_name}</p>
          )}
        </div>

        {/* Items */}
        <table className="w-full text-sm">
          <thead className="border-y border-border text-left text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Rate</th>
              {layout.show_gst && <th className="py-2 text-right font-medium">GST%</th>}
              {layout.show_gst &&
                (intraState ? (
                  <>
                    <th className="py-2 text-right font-medium">CGST</th>
                    <th className="py-2 text-right font-medium">SGST</th>
                  </>
                ) : (
                  <th className="py-2 text-right font-medium">IGST</th>
                ))}
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id} className="border-b border-border">
                <td className="py-2">
                  {it.description}
                  {it.subtext && <p className="text-xs text-muted-foreground">{it.subtext}</p>}
                </td>
                <td className="py-2 text-right">{it.quantity}</td>
                <td className="py-2 text-right">{formatINR(it.rate)}</td>
                {layout.show_gst && <td className="py-2 text-right">{it.gst_rate}%</td>}
                {layout.show_gst &&
                  (intraState ? (
                    <>
                      <td className="py-2 text-right">{formatINR(it.cgst)}</td>
                      <td className="py-2 text-right">{formatINR(it.sgst)}</td>
                    </>
                  ) : (
                    <td className="py-2 text-right">{formatINR(it.igst)}</td>
                  ))}
                <td className="py-2 text-right">{formatINR(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <Row label="Subtotal" value={formatINR(data.subtotal)} />
            {data.discount > 0 && <Row label="Discount" value={`− ${formatINR(data.discount)}`} />}
            {layout.show_gst && <Row label="Taxable" value={formatINR(data.taxable)} />}
            {layout.show_gst && <Row label="Tax" value={formatINR(data.tax)} />}
            <div className="my-1 border-t border-border" />
            <Row label="Total" value={formatINR(data.total)} strong />
            <Row label="Paid" value={formatINR(data.amount_paid)} />
            <Row label="Balance due" value={formatINR(data.balance_due)} strong />
          </div>
        </div>

        <p className="mt-4 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Amount in words: </span>
          {amountInWords(data.total)} only
        </p>

        {data.notes && (
          <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{data.notes}</p>
        )}

        {data.payments.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Payments received</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {data.payments.map((p) => (
                <li key={p.id} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {p.paid_on}
                      {p.mode ? ` · ${humanize(p.mode)}` : ''}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </span>
                    <span className="font-medium">{formatINR(p.amount)}</span>
                  </div>
                  {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {layout.show_footer && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3 text-sm">
            {(() => {
              const bank = data.bank_details ?? (layout.show_bank_details ? layout.bank_details : null)
              const terms = data.terms ?? layout.terms_and_conditions
              return (
                <>
                  {layout.show_bank_details && bank && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Bank details</p>
                      <p className="whitespace-pre-line">{bank}</p>
                    </div>
                  )}
                  {terms && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Terms &amp; conditions</p>
                      <p className="whitespace-pre-line text-muted-foreground">{terms}</p>
                    </div>
                  )}
                </>
              )
            })()}
            {layout.footer_text && <p className="text-center text-xs text-muted-foreground">{layout.footer_text}</p>}
          </div>
        )}
      </div>

    </>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'text-base font-semibold' : 'font-medium'}>{value}</span>
    </div>
  )
}

function EditInvoiceDialog({ invoice, autoOpen }: { invoice: InvoiceDetail; autoOpen?: boolean | undefined }) {
  const update = useUpdateInvoice(invoice.id)
  const { data: states } = useStates()
  const [open, setOpen] = useState(autoOpen ?? false)
  const allZeroGst = invoice.items.every((i) => Number(i.gst_rate) === 0)
  const form = useInvoiceForm({
    client_id: invoice.client_id ?? '',
    project_id: invoice.project_id ?? '',
    place_of_supply: invoice.place_of_supply ?? '27',
    intra_state: invoice.intra_state,
    no_gst: allZeroGst,
    gst_number: invoice.gst_number ?? '',
    status: invoice.status === 'draft' ? 'draft' : 'sent',
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date ?? '',
    discount: invoice.discount ? String(invoice.discount) : '',
    // Preserve the original discount type on edit — including 'none'.
    discount_type: (invoice.discount_type ?? 'flat') as 'flat' | 'percent' | 'none',
    notes: invoice.notes ?? '',
    bank_details: invoice.bank_details ?? '',
    terms: invoice.terms ?? '',
    template_id: invoice.template_id ?? '',
    invoice_number: '',
    lines: invoice.items.map((i) => ({
      description: i.description,
      subtext: i.subtext ?? undefined,
      quantity: String(i.quantity),
      rate: String(i.rate),
      gst_rate: Number(i.gst_rate),
    })),
  })
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const problems = form.problems()
    if (problems.length > 0) {
      setError(problems[0] ?? 'This invoice is not ready yet.')
      return
    }
    try {
      await update.mutateAsync(form.toRequest())
      setOpen(false)
    } catch (err) {
      setError(friendlyInvoiceError(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Edit invoice"
        description="No payment is recorded yet, so the whole invoice can still be corrected."
        className="max-w-2xl"
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <InvoiceFormFields form={form} states={states} isEdit />
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
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const del = useDeleteInvoice()
  const confirm = useConfirm()
  const navigate = useNavigate()

  async function onDelete() {
    const yes = await confirm({
      title: 'Delete this invoice?',
      description: 'No payment has been recorded against it yet. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (!yes) return
    await del.mutateAsync(invoiceId)
    void navigate({ to: '/billing' })
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void onDelete()} disabled={del.isPending}>
      <Trash2 /> Delete
    </Button>
  )
}

function DetailRecordPayment({ invoiceId, balance }: { invoiceId: string; balance: number }) {
  const record = useRecordPayment(invoiceId)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(balance))
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState('')
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
          Record payment
        </Button>
      </DialogTrigger>
      <DialogContent title="Record payment" description={`Balance due ${formatINR(balance)}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Amount</label>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Payment date</label>
              <DateField aria-label="Payment date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Reference (optional)</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="UTR / txn id"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
          </div>
          <PaymentModePicker value={mode} onChange={setMode} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Notes (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Part payment via UPI"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
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
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Copy public link + Email dialog (multi-email, mailto/copy fallback) +
 * WhatsApp share for a GST invoice (Lovable InvoiceActions parity).
 *
 * Invoices have no server-issued public token, so the "public link" is the
 * in-app invoice URL and email goes through the studio mail client — the
 * same provider_missing → mailto/copy fallback shape as receipts.
 */
function InvoiceShareActions({ invoice }: { invoice: InvoiceDetail }) {
  const [emailOpen, setEmailOpen] = useState(false)
  const link = typeof window !== 'undefined' ? window.location.href : ''
  const text = `Invoice ${invoice.invoice_number} for ${formatINR(invoice.total)}. Balance ${formatINR(invoice.balance_due)}. View: ${link}`

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Public invoice link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void onCopy()}>
        <Copy /> Copy link
      </Button>
      <Button size="sm" variant="outline" onClick={() => setEmailOpen(true)}>
        <Mail /> Email
      </Button>
      <Button size="sm" variant="outline" asChild>
        <a href={buildWhatsAppUrl(invoice.client_phone, text)} target="_blank" rel="noreferrer">
          <MessageCircle /> WhatsApp
        </a>
      </Button>
      <InvoiceEmailDialog invoice={invoice} open={emailOpen} onOpenChange={setEmailOpen} link={link} />
    </>
  )
}

const INVOICE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function InvoiceEmailDialog({
  invoice,
  open,
  onOpenChange,
  link,
}: {
  invoice: InvoiceDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  link: string
}) {
  const seed = (invoice.client_email ?? '').trim().toLowerCase()
  const [emails, setEmails] = useState<string[]>([])
  const [input, setInput] = useState('')

  function reset() {
    setEmails(seed && INVOICE_EMAIL_RE.test(seed) ? [seed] : [])
    setInput('')
  }

  function addEmail() {
    const v = input.trim().toLowerCase()
    if (!v) return
    if (!INVOICE_EMAIL_RE.test(v)) {
      toast.error('Please enter a valid email address.')
      return
    }
    if (emails.includes(v)) {
      toast.error('This email is already added.')
      return
    }
    setEmails((prev) => [...prev, v])
    setInput('')
  }

  async function onSend() {
    const pending = input.trim().toLowerCase()
    const toSend = [...emails]
    if (pending) {
      if (!INVOICE_EMAIL_RE.test(pending)) {
        toast.error('Please enter a valid email address.')
        return
      }
      if (!toSend.includes(pending)) toSend.push(pending)
    }
    if (toSend.length === 0) {
      toast.error('Add at least one email to share the invoice.')
      return
    }
    // No invoice email provider — mailto fallback (same as receipt
    // provider_missing): first recipient in To, rest in the body.
    const [first, ...rest] = toSend
    const subject = `Invoice ${invoice.invoice_number} — ${formatINR(invoice.total)}`
    const body = [
      `Hi ${invoice.client_name || 'there'},`,
      ``,
      `Please find your invoice ${invoice.invoice_number} for ${formatINR(invoice.total)} (balance ${formatINR(invoice.balance_due)}).`,
      `View it here: ${link}`,
      rest.length > 0 ? `Also sent to: ${rest.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    window.location.href = buildMailtoUrl(first, subject, body)
    try {
      await navigator.clipboard.writeText(link)
      toast.message('Opened your email client — invoice link also copied.')
    } catch {
      toast.message('Opened your email client.')
    }
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent title="Email invoice" description="Send this invoice by email. You can add multiple recipients.">
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-semibold">{invoice.invoice_number}</span>
              <span className="font-bold tabular-nums">{formatINR(invoice.total)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {invoice.client_name ?? '—'} · Balance {formatINR(invoice.balance_due)}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Recipient emails</Label>
            {emails.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {emails.map((e) => (
                  <span key={e} className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 py-1 pl-2.5 pr-1 text-xs">
                    <span className="max-w-[200px] truncate">{e}</span>
                    <button
                      type="button"
                      onClick={() => setEmails((prev) => prev.filter((x) => x !== e))}
                      className="inline-flex size-5 items-center justify-center rounded hover:bg-foreground/10"
                      aria-label={`Remove ${e}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                type="email"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addEmail()
                  }
                }}
                placeholder="client@email.com"
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={addEmail}>
                <Plus className="mr-1 size-4" /> Add
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" onClick={() => void onSend()}>
              <Mail /> Send via email app
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

