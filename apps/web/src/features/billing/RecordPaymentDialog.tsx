import { useState, type FormEvent, type ReactNode } from 'react'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import type { ProjectDetail, ReceivedPayment } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useINR } from '@/shared/money/MoneyMask'
import { useAddPayment, useUpdatePayment } from '@/features/projects/api'
import { useClients } from '@/features/clients/api'
import { useCreateReceivedPayment, useInvoices, useRecordPayment, useUpdateReceivedPayment } from './api'
import { useClientProjectOptions } from './client-projects'
import { leftToPayLine } from './left-to-pay'
import { todayInIndia } from '@/shared/ui/days-left'
import {
  blankPaymentForm,
  checkPaymentForm,
  formFromReceived,
  invoiceChoices,
  ledgerCreateBody,
  ledgerPatchBody,
  moreLabel,
  paymentQuestions,
  type PaymentForm,
  type PaymentFormKind,
} from './payment-form'

type Payment = ProjectDetail['payments'][number]

/** An invoice the money can be put against. */
export interface OpenInvoice {
  id: string
  invoice_number: string
  balance_due: number
  due_date?: string | null | undefined
  project_id?: string | null | undefined
}

/**
 * Where the payment is recorded:
 * - on a project: received or promised, optionally against one of its invoices;
 * - on an invoice (from Billing): money that has come in against that invoice;
 * - picked in the form (+ New, Payments received, the invoice page's "Change"):
 *   client and project first, then the same questions. `payment` is a row
 *   from the Payments list to change.
 */
export type PaymentTarget =
  | { kind: 'project'; projectId: string; invoices?: OpenInvoice[] | undefined; invoiceId?: string | undefined }
  | { kind: 'invoice'; invoiceId: string; invoiceNumber: string }
  | { kind: 'pick'; payment?: ReceivedPayment | undefined }

/** How money comes in -- the chips on every payment dialog. */
export const PAYMENT_MODES = ['UPI', 'Cash', 'Bank transfer', 'Cheque', 'Card']
const MODES = PAYMENT_MODES

/**
 * The one payment form. Record or change a payment received: how much, when,
 * how, whether it has come in or is only promised, and which invoice it
 * settles. Reference, note, GST and receipt link sit under "More".
 *
 * Every place that records money opens this: a project's Billing tab, the
 * invoices list and page, + New and Payments received. There used to be a
 * second dialog for the last two, asking other questions in another order.
 */
export function RecordPaymentDialog({
  target,
  payment,
  suggested = 0,
  dueOn,
  onClose,
}: {
  target: PaymentTarget
  /** A project payment to change (project target only). */
  payment?: Payment | undefined
  suggested?: number | undefined
  /** When the suggested amount falls due, for the "₹X is left" line. */
  dueOn?: string | null | undefined
  onClose: () => void
}) {
  if (target.kind === 'pick') return <PickedPaymentDialog payment={target.payment} onClose={onClose} />
  return <PlacedPaymentDialog target={target} payment={payment} suggested={suggested} dueOn={dueOn} onClose={onClose} />
}

/** The form's state, kept on this device as it is typed until it is saved. */
function usePaymentFormState(draftKey: string, start: () => PaymentForm) {
  const [initial] = useState(start)
  const [form, setForm] = useState(initial)
  const [more, setMore] = useState(!!(initial.reference || initial.description || initial.isGst || initial.fileUrl))
  const draft = useFormDraft(draftKey, form, (v) => {
    // A draft from before a field existed brings back only what it has.
    const next = { ...initial, ...v }
    setForm(next)
    if (next.reference || next.description || next.isGst || next.fileUrl) setMore(true)
  })
  const set = <K extends keyof PaymentForm>(key: K, value: PaymentForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  return { form, setForm, set, more, setMore, draft }
}

type FormState = ReturnType<typeof usePaymentFormState>

/** On a project or an invoice: saves through that project's or invoice's own payment route. */
function PlacedPaymentDialog({
  target,
  payment,
  suggested,
  dueOn,
  onClose,
}: {
  target: Exclude<PaymentTarget, { kind: 'pick' }>
  payment?: Payment | undefined
  suggested: number
  dueOn?: string | null | undefined
  onClose: () => void
}) {
  const inr = useINR()
  const projectId = target.kind === 'project' ? target.projectId : ''
  const add = useAddPayment(projectId)
  const update = useUpdatePayment(projectId)
  const recordOnInvoice = useRecordPayment(target.kind === 'invoice' ? target.invoiceId : '')
  const editing = !!payment
  const invoices = target.kind === 'project' ? (target.invoices ?? []) : []
  const state = usePaymentFormState(
    `payment:${target.kind === 'invoice' ? target.invoiceId : target.projectId}:${payment?.id ?? 'new'}`,
    () => {
      const invoiceId = payment?.invoice_id ?? (target.kind === 'project' ? (target.invoiceId ?? '') : target.invoiceId)
      if (payment) {
        return blankPaymentForm(todayInIndia(), {
          invoiceId,
          amount: String(payment.amount),
          paidOn: payment.paid_on.slice(0, 10),
          mode: payment.mode ?? 'UPI',
          received: (payment.status ?? 'paid') !== 'pending',
          reference: payment.reference ?? '',
          description: payment.description ?? '',
          isGst: payment.is_gst ?? false,
          gstNumber: payment.gst_number ?? '',
        })
      }
      const picked = invoices.find((i) => i.id === invoiceId)
      const start = picked ? picked.balance_due : suggested
      return blankPaymentForm(todayInIndia(), { invoiceId, amount: start > 0 ? String(start) : '' })
    },
  )
  const { form, set } = state
  const [error, setError] = useState<string | null>(null)
  const picked = invoices.find((i) => i.id === form.invoiceId)
  const busy = add.isPending || update.isPending || recordOnInvoice.isPending

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const wrong = checkPaymentForm(form, { needsLink: false })
    if (wrong) {
      setError(wrong)
      return
    }
    const value = Number(form.amount)
    const done = {
      onSuccess: () => {
        state.draft.clear()
        onClose()
      },
      onError: (err: Error) => setError(err.message),
    }
    if (target.kind === 'invoice') {
      recordOnInvoice.mutate(
        {
          amount: value,
          paid_on: form.paidOn,
          ...(form.mode.trim() ? { mode: form.mode.trim() } : {}),
          ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
          ...(form.description.trim() ? { notes: form.description.trim() } : {}),
        },
        done,
      )
      return
    }
    const body = {
      amount: value,
      paid_on: form.paidOn,
      mode: form.mode.trim() || undefined,
      status: form.received ? ('paid' as const) : ('pending' as const),
      reference: form.reference.trim() || undefined,
      description: form.description.trim() || undefined,
      is_gst: form.isGst,
      gst_number: form.isGst && form.gstNumber.trim() ? form.gstNumber.trim() : undefined,
      invoice_id: form.invoiceId || null,
    }
    if (editing) {
      update.mutate(
        {
          paymentId: payment.id,
          patch: { ...body, reference: body.reference ?? null, description: body.description ?? null, gst_number: body.gst_number ?? null },
        },
        done,
      )
    } else {
      add.mutate(body, done)
    }
  }

  return (
    <PaymentDialogFrame
      kind={target.kind}
      state={state}
      editing={editing}
      description={target.kind === 'invoice' ? `Against ${target.invoiceNumber}${suggested > 0 ? ` · ${inr(suggested)} due` : ''}` : undefined}
      invoiceField={
        target.kind === 'project' && (invoices.length > 0 || form.invoiceId) ? (
          <InvoiceSelect
            invoices={invoices}
            value={form.invoiceId}
            blank="No invoice -- just the project"
            fallback={payment?.invoice_number ?? 'Invoice'}
            onChange={(id, inv) => {
              set('invoiceId', id)
              if (inv && !editing && inv.balance_due > 0) set('amount', String(inv.balance_due))
            }}
          />
        ) : null
      }
      due={picked ? picked.balance_due : suggested}
      dueOn={picked ? picked.due_date : dueOn}
      error={error}
      busy={busy}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}

/**
 * Started from nothing (+ New, Payments received) or a row of the Payments
 * list: the client and project are picked first. Saves through
 * /billing/payments, which also takes a payment against an invoice with no
 * project (0145), the client and the receipt link.
 */
function PickedPaymentDialog({ payment, onClose }: { payment?: ReceivedPayment | undefined; onClose: () => void }) {
  const editing = !!payment
  const create = useCreateReceivedPayment()
  const update = useUpdateReceivedPayment(payment?.id ?? '')
  const state = usePaymentFormState(`payment:pick:${payment?.id ?? 'new'}`, () =>
    payment ? formFromReceived(payment, todayInIndia()) : blankPaymentForm(todayInIndia()),
  )
  const { form, setForm } = state
  const [error, setError] = useState<string | null>(null)

  const { data: clientsData } = useClients()
  const clients = Array.isArray(clientsData) ? clientsData : (clientsData?.items ?? [])
  const linked = payment?.project_id ? { id: payment.project_id, name: payment.project_name ?? 'This project' } : null
  const projects = useClientProjectOptions(form.clientId, linked)
  // A change can move the payment to another of the client's invoices, or off
  // one; both invoices' totals follow (0145).
  const invoicesQ = useInvoices(
    form.clientId ? { client_id: form.clientId, page_size: 200 } : undefined,
    { enabled: !!form.clientId },
  )
  const rows = invoicesQ.isPlaceholderData ? [] : (invoicesQ.data?.items ?? [])
  const invoices = invoiceChoices(rows, form.projectId, form.invoiceId)
  const pickedInvoice = invoices.find((i) => i.id === form.invoiceId)
  const pickedProject = projects.options.find((p) => p.id === form.projectId)
  const busy = create.isPending || update.isPending

  function pickClient(id: string) {
    setForm((f) => ({ ...f, clientId: id, projectId: '', invoiceId: '' }))
  }

  function pickProject(id: string) {
    const due = projects.options.find((p) => p.id === id)?.due ?? 0
    setForm((f) => {
      const keepInvoice = !!f.invoiceId && rows.find((i) => i.id === f.invoiceId)?.project_id === id
      const next = { ...f, projectId: id, invoiceId: keepInvoice ? f.invoiceId : '' }
      if (!editing && !next.invoiceId && due > 0) next.amount = String(due)
      return next
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const wrong = checkPaymentForm(form, { needsLink: true })
    if (wrong) {
      setError(wrong)
      return
    }
    const done = {
      onSuccess: () => {
        state.draft.clear()
        onClose()
      },
      onError: (err: Error) => setError(err.message),
    }
    if (editing) update.mutate(ledgerPatchBody(form, payment), done)
    else create.mutate(ledgerCreateBody(form), done)
  }

  const nudge = (empty: boolean) =>
    cn('[&>button]:transition-colors', empty ? '[&>button]:border-dashed [&>button]:border-tone-amber/60 [&>button]:bg-tone-amber-soft/40' : '[&>button]:border-success/50')

  const place = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pay-client">Client</Label>
        <Select id="pay-client" aria-label="Client" value={form.clientId} onChange={(e) => pickClient(e.target.value)} className={nudge(!form.clientId)}>
          <option value="">Choose the client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {form.clientId && !clients.some((c) => c.id === form.clientId) && <option value={form.clientId}>{payment?.client_name ?? 'Client'}</option>}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pay-project">Project</Label>
        <Select
          id="pay-project"
          aria-label="Project"
          value={form.projectId}
          onChange={(e) => pickProject(e.target.value)}
          disabled={!form.clientId}
          className={form.clientId ? nudge(!form.projectId && !form.invoiceId) : undefined}
        >
          <option value="">{!form.clientId ? 'Choose the client first' : projects.loaded && projects.count > 0 ? 'No project -- pay an invoice' : projects.blank}</option>
          {projects.options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )

  return (
    <PaymentDialogFrame
      kind="pick"
      state={state}
      editing={editing}
      place={place}
      invoiceField={
        form.clientId && (invoices.length > 0 || form.invoiceId) ? (
          <InvoiceSelect
            invoices={invoices}
            value={form.invoiceId}
            blank={form.projectId ? 'No invoice -- just the project' : 'Choose an invoice'}
            fallback={form.invoiceId === payment?.invoice_id ? (payment?.invoice_number ?? 'Invoice') : 'Invoice'}
            onChange={(id, inv) =>
              setForm((f) => ({
                ...f,
                invoiceId: id,
                // The invoice's project comes with it, so the two never disagree.
                projectId: inv?.project_id && !f.projectId ? inv.project_id : f.projectId,
                // A new payment starts from what the invoice still owes; a
                // change keeps its own amount when it moves to another invoice.
                amount: !editing && inv && inv.balance_due > 0 ? String(inv.balance_due) : f.amount,
              }))
            }
          />
        ) : null
      }
      due={pickedInvoice ? pickedInvoice.balance_due : (pickedProject?.due ?? 0)}
      dueOn={pickedInvoice?.due_date}
      error={error}
      busy={busy}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}

function InvoiceSelect({
  invoices,
  value,
  blank,
  fallback,
  onChange,
}: {
  invoices: OpenInvoice[]
  value: string
  blank: string
  fallback: string
  onChange: (id: string, invoice: OpenInvoice | undefined) => void
}) {
  const inr = useINR()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="pay-invoice">Against invoice</Label>
      <Select id="pay-invoice" value={value} onChange={(e) => onChange(e.target.value, invoices.find((i) => i.id === e.target.value))}>
        <option value="">{blank}</option>
        {invoices.map((i) => (
          <option key={i.id} value={i.id}>
            {i.invoice_number} · {inr(i.balance_due)} due
          </option>
        ))}
        {value && !invoices.some((i) => i.id === value) && <option value={value}>{fallback}</option>}
      </Select>
    </div>
  )
}

/** The form itself: the same questions, in the same order, wherever it opens. */
function PaymentDialogFrame({
  kind,
  state,
  editing,
  description,
  place,
  invoiceField,
  due,
  dueOn,
  error,
  busy,
  onSubmit,
  onClose,
}: {
  kind: PaymentFormKind
  state: FormState
  editing: boolean
  description?: string | undefined
  place?: ReactNode
  invoiceField: ReactNode
  due: number
  dueOn?: string | null | undefined
  error: string | null
  busy: boolean
  onSubmit: (e: FormEvent) => void
  onClose: () => void
}) {
  const { form, set, more, setMore } = state
  const q = paymentQuestions(kind)
  const received = !q.status || form.received
  const value = Number(form.amount) || 0
  const needsReference = q.reference && (form.mode === 'UPI' || form.mode === 'Bank transfer')
  const leftLine = leftToPayLine({ due, amount: value, received, editing, dueOn, today: todayInIndia() })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={editing ? 'Edit payment' : 'Record payment'} description={description}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {place}
          {q.status && (
            <div role="radiogroup" aria-label="Has it come in?" className="grid grid-cols-2 gap-1 rounded-lg border border-input p-1">
              {[
                { v: true, label: 'Received', hint: 'The money is in' },
                { v: false, label: 'Promised', hint: 'Not received yet' },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={form.received === o.v}
                  onClick={() => set('received', o.v)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-left transition-colors',
                    form.received === o.v ? (o.v ? 'bg-tone-green-soft text-tone-green' : 'bg-tone-amber-soft text-tone-amber') : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span className="block text-sm font-semibold">{o.label}</span>
                  <span className="block text-[11px]">{o.hint}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-amount">Amount (₹)</Label>
              <Input id="pay-amount" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} autoFocus={kind !== 'pick'} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-date">{received ? 'Received on' : 'Expected on'}</Label>
              <Input id="pay-date" type="date" value={form.paidOn} onChange={(e) => set('paidOn', e.target.value)} />
            </div>
          </div>
          {leftLine && <p className="-mt-1 text-xs text-muted-foreground">{leftLine}</p>}
          {invoiceField}
          <div className="flex flex-col gap-1.5">
            <Label>How</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="How it was paid">
              {[...MODES, ...(form.mode && !MODES.includes(form.mode) ? [form.mode] : [])].map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={form.mode === m}
                  onClick={() => set('mode', m)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    form.mode === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {more || needsReference ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {q.reference && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pay-ref">Reference{needsReference ? ' (UTR / transaction id)' : ''}</Label>
                    <Input id="pay-ref" value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="UTR / cheque no." />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-note">Note</Label>
                  <Input id="pay-note" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Advance, final settlement…" />
                </div>
                {q.receiptLink && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pay-file">Receipt link</Label>
                    <Input id="pay-file" inputMode="url" value={form.fileUrl} onChange={(e) => set('fileUrl', e.target.value)} placeholder="https://…" />
                  </div>
                )}
              </div>
              {q.gst && (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.isGst} onChange={(e) => set('isGst', e.target.checked)} />
                    GST receipt
                  </label>
                  {form.isGst && (
                    <Input aria-label="GST number" value={form.gstNumber} onChange={(e) => set('gstNumber', e.target.value)} placeholder="GST number, e.g. 27ABCDE1234F1Z5" />
                  )}
                </>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => setMore(true)} className="self-start text-xs font-medium text-primary hover:underline">
              {moreLabel(q)}
            </button>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || value <= 0}>
              {busy ? 'Saving…' : editing ? 'Save' : received ? 'Save payment' : 'Save as promised'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
