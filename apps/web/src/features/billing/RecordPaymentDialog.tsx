import { useState, type FormEvent } from 'react'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import type { ProjectDetail } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useAddPayment, useUpdatePayment } from '@/features/projects/api'
import { useRecordPayment } from './api'

type Payment = ProjectDetail['payments'][number]

/** An invoice the money can be put against. */
export interface OpenInvoice {
  id: string
  invoice_number: string
  balance_due: number
}

/**
 * Where the payment is recorded:
 * - on a project: received or promised, optionally against one of its invoices;
 * - on an invoice (from Billing): money that has come in against that invoice.
 */
export type PaymentTarget =
  | { kind: 'project'; projectId: string; invoices?: OpenInvoice[] | undefined; invoiceId?: string | undefined }
  | { kind: 'invoice'; invoiceId: string; invoiceNumber: string }

const MODES = ['UPI', 'Cash', 'Bank transfer', 'Cheque', 'Card']

/**
 * The one payment form. Record or change a payment: how much, when, how,
 * and -- on a project -- whether it has come in or is only promised, and
 * which invoice it settles. Reference, note and GST sit under "More".
 *
 * There used to be three of these (project tab, Billing list, invoice page),
 * each asking slightly different questions.
 */
export function RecordPaymentDialog({
  target,
  payment,
  suggested,
  onClose,
}: {
  target: PaymentTarget
  payment?: Payment | undefined
  suggested: number
  onClose: () => void
}) {
  const projectId = target.kind === 'project' ? target.projectId : ''
  const add = useAddPayment(projectId)
  const update = useUpdatePayment(projectId)
  const recordOnInvoice = useRecordPayment(target.kind === 'invoice' ? target.invoiceId : '')
  const editing = !!payment
  const onProject = target.kind === 'project'
  const invoices = target.kind === 'project' ? (target.invoices ?? []) : []

  const [invoiceId, setInvoiceId] = useState(
    payment?.invoice_id ?? (target.kind === 'project' ? (target.invoiceId ?? '') : target.invoiceId),
  )
  const picked = invoices.find((i) => i.id === invoiceId)
  const [amount, setAmount] = useState(() => {
    if (payment) return String(payment.amount)
    const start = picked ? picked.balance_due : suggested
    return start > 0 ? String(start) : ''
  })
  const [paidOn, setPaidOn] = useState(payment?.paid_on.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState(payment?.mode ?? 'UPI')
  const [received, setReceived] = useState((payment?.status ?? 'paid') !== 'pending')
  const [more, setMore] = useState(!!(payment?.reference || payment?.description || payment?.is_gst))
  const [reference, setReference] = useState(payment?.reference ?? '')
  const [description, setDescription] = useState(payment?.description ?? '')
  const [isGst, setIsGst] = useState(payment?.is_gst ?? false)
  const [gstNumber, setGstNumber] = useState(payment?.gst_number ?? '')
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    `payment:${target.kind === 'invoice' ? target.invoiceId : target.projectId}:${payment?.id ?? 'new'}`,
    { invoiceId, amount, paidOn, mode, received, reference, description, isGst, gstNumber },
    (v) => {
      setInvoiceId(v.invoiceId)
      setAmount(v.amount)
      setPaidOn(v.paidOn)
      setMode(v.mode)
      setReceived(v.received)
      setReference(v.reference)
      setDescription(v.description)
      setIsGst(v.isGst)
      setGstNumber(v.gstNumber)
      if (v.reference || v.description || v.isGst) setMore(true)
    },
  )
  const busy = add.isPending || update.isPending || recordOnInvoice.isPending
  const value = Number(amount) || 0
  const needsReference = mode === 'UPI' || mode === 'Bank transfer'

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (value <= 0) {
      setError('Enter the amount.')
      return
    }
    const done = {
      onSuccess: () => {
        draft.clear()
        onClose()
      },
      onError: (err: Error) => setError(err.message),
    }
    if (target.kind === 'invoice') {
      recordOnInvoice.mutate(
        {
          amount: value,
          paid_on: paidOn,
          ...(mode.trim() ? { mode: mode.trim() } : {}),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(description.trim() ? { notes: description.trim() } : {}),
        },
        done,
      )
      return
    }
    const body = {
      amount: value,
      paid_on: paidOn,
      mode: mode.trim() || undefined,
      status: received ? ('paid' as const) : ('pending' as const),
      reference: reference.trim() || undefined,
      description: description.trim() || undefined,
      is_gst: isGst,
      gst_number: isGst && gstNumber.trim() ? gstNumber.trim() : undefined,
      invoice_id: invoiceId || null,
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

  const description_ =
    target.kind === 'invoice'
      ? `Against ${target.invoiceNumber}${suggested > 0 ? ` · ${formatINR(suggested)} due` : ''}`
      : suggested > 0 && !editing
        ? `${formatINR(suggested)} is still to collect.`
        : undefined

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={editing ? 'Change payment' : 'Record payment'} description={description_}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {onProject && (
            <div role="radiogroup" aria-label="Has it come in?" className="grid grid-cols-2 gap-1 rounded-lg border border-input p-1">
              {[
                { v: true, label: 'Received', hint: 'The money is in' },
                { v: false, label: 'Promised', hint: 'Not received yet' },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={received === o.v}
                  onClick={() => setReceived(o.v)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-left transition-colors',
                    received === o.v ? (o.v ? 'bg-tone-green-soft text-tone-green' : 'bg-tone-amber-soft text-tone-amber') : 'text-muted-foreground hover:bg-muted',
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
              <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-date">{received ? 'Received on' : 'Expected on'}</Label>
              <Input id="pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
          </div>
          {onProject && (invoices.length > 0 || invoiceId) && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-invoice">Against invoice</Label>
              <Select
                id="pay-invoice"
                value={invoiceId}
                onChange={(e) => {
                  setInvoiceId(e.target.value)
                  const inv = invoices.find((i) => i.id === e.target.value)
                  if (inv && !editing && inv.balance_due > 0) setAmount(String(inv.balance_due))
                }}
              >
                <option value="">No invoice -- just the project</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number} · {formatINR(i.balance_due)} due
                  </option>
                ))}
                {invoiceId && !invoices.some((i) => i.id === invoiceId) && (
                  <option value={invoiceId}>{payment?.invoice_number ?? 'Invoice'}</option>
                )}
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>How</Label>
            <div className="flex flex-wrap gap-1.5">
              {[...MODES, ...(mode && !MODES.includes(mode) ? [mode] : [])].map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    mode === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted',
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
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-ref">Reference{needsReference ? ' (UTR / transaction id)' : ''}</Label>
                  <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-note">Note</Label>
                  <Input id="pay-note" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Advance, final settlement…" />
                </div>
              </div>
              {onProject && (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={isGst} onChange={(e) => setIsGst(e.target.checked)} />
                    GST receipt
                  </label>
                  {isGst && (
                    <Input aria-label="GST number" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="GST number, e.g. 27ABCDE1234F1Z5" />
                  )}
                </>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => setMore(true)} className="self-start text-xs font-medium text-primary hover:underline">
              + Reference, note{onProject ? ' or GST' : ''}
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
              {busy ? 'Saving…' : editing ? 'Save' : received ? 'Record payment' : 'Save as promised'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
