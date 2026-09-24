import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, FileText, Hourglass, IndianRupee, MessageCircle, Pencil, Plus, Receipt, Trash2, TrendingUp } from 'lucide-react'
import type { ProjectDetail } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { RowMenu } from '@/shared/ui/row-menu'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { useAddPayment, useDeletePayment, useUpdatePayment, useUpdateQuotation } from '@/features/projects/api'
import { useProjectFinancials } from '@/features/financials/api'
import { issueReceiptLink, openReceiptWhatsApp, receiptShareText } from '@/features/billing/receiptShare'

type Payment = ProjectDetail['payments'][number]

/**
 * The project's money in the three numbers an owner asks about: what the
 * project is worth, what has come in, and what is still to collect. A
 * "promised" payment (recorded as pending) is shown for what it is -- money
 * someone said is coming -- and never counted as received.
 */
export function projectMoney(p: Pick<ProjectDetail, 'total_cost' | 'payments' | 'package_cost' | 'additional_deliverables_cost'>) {
  const isPaid = (x: Payment) => (x.status ?? 'paid') !== 'pending'
  const received = p.payments.filter(isPaid).reduce((n, x) => n + x.amount, 0)
  const promised = p.payments.filter((x) => !isPaid(x)).reduce((n, x) => n + x.amount, 0)
  const due = Math.max(0, p.total_cost - received)
  const pct = p.total_cost > 0 ? Math.min(100, Math.round((received / p.total_cost) * 100)) : 0
  return { total: p.total_cost, received, promised, due, pct, isPaid }
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** "₹1,50,000 of ₹2,27,000 collected" with a bar -- used on Overview and Billing. */
export function CollectionBar({ project, onRecord }: { project: ProjectDetail; onRecord?: (() => void) | undefined }) {
  const m = projectMoney(project)
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm">
          <span className="text-lg font-semibold tabular-nums">{formatINR(m.received)}</span>
          <span className="text-muted-foreground"> of {formatINR(m.total)} collected</span>
        </p>
        <p className={cn('text-sm font-medium tabular-nums', m.due > 0 ? 'text-warning' : 'text-tone-green')}>
          {m.due > 0 ? `${formatINR(m.due)} still to collect` : 'Fully paid'}
        </p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={m.pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Collected"
      >
        <div className="h-full rounded-full bg-tone-green transition-[width]" style={{ width: `${m.pct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Package {formatINR(project.package_cost)}
          {project.additional_deliverables_cost > 0 ? ` + extras ${formatINR(project.additional_deliverables_cost)}` : ''}
          {m.promised > 0 ? ` · ${formatINR(m.promised)} promised, not yet received` : ''}
        </span>
        {onRecord && (
          <Button size="sm" onClick={onRecord}>
            <Plus /> Record payment
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Billing: collect the money, then see what the project made.
 *
 * Payments first, because that is what is done here most -- record one, mark
 * a promised one as received, send the receipt. Profit is one small card for
 * those who may see it. The monthly allocation report, with its methods and
 * pickers, lives on the Profit page where it belongs.
 */
export function BillingTab({ project, canEdit }: { project: ProjectDetail; canEdit: boolean }) {
  const [editing, setEditing] = useState<Payment | 'new' | null>(null)
  const m = projectMoney(project)
  const payments = [...project.payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on))

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card>
        <CardContent className="p-4">
          <CollectionBar project={project} onRecord={canEdit ? () => setEditing('new') : undefined} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <IndianRupee className="size-4 text-tone-green" aria-hidden /> Payments
            <span className="text-xs font-normal text-muted-foreground">{payments.length}</span>
          </p>
          {payments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">No payments yet. Record the advance when it comes in.</p>
              {canEdit && (
                <Button size="sm" onClick={() => setEditing('new')}>
                  <Plus /> Record payment
                </Button>
              )}
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {payments.map((p) => (
                <PaymentItem
                  key={p.id}
                  p={p}
                  paid={m.isPaid(p)}
                  project={project}
                  canEdit={canEdit}
                  onEdit={() => setEditing(p)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ProfitCard project={project} />
      <QuotationCard project={project} canEdit={canEdit} />

      {editing && (
        <PaymentDialog
          key={editing === 'new' ? 'new' : editing.id}
          projectId={project.id}
          payment={editing === 'new' ? undefined : editing}
          suggested={m.due}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function PaymentItem({
  p,
  paid,
  project,
  canEdit,
  onEdit,
}: {
  p: Payment
  paid: boolean
  project: ProjectDetail
  canEdit: boolean
  onEdit: () => void
}) {
  const update = useUpdatePayment(project.id)
  const del = useDeletePayment(project.id)
  const confirm = useConfirm()
  const canShareReceipt = useAccess().hasModule('billing')

  const summary = {
    clientName: project.client_name,
    projectName: project.name,
    amountFormatted: formatINR(p.amount),
    paymentDate: day(p.paid_on),
  }

  async function whatsappReceipt() {
    // With Billing access the client gets a proper receipt page; without it,
    // a plain message saying the same thing.
    const link = canShareReceipt ? await issueReceiptLink(p.id) : null
    const text = link
      ? receiptShareText(summary, link)
      : `Payment received — thank you!\n${project.name}\nAmount: ${formatINR(p.amount)}\nDate: ${day(p.paid_on)}${p.mode ? `\nMode: ${p.mode}` : ''}`
    openReceiptWhatsApp(project.client_phone, text)
  }

  const details = [day(p.paid_on), p.mode?.toUpperCase(), p.reference, p.description, p.is_gst ? `GST ${p.gst_number ?? ''}`.trim() : null].filter(Boolean)

  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2', paid ? 'border-border bg-card' : 'border-tone-amber/40 bg-tone-amber-soft/30')}>
      {paid ? (
        <CheckCircle2 className="size-5 shrink-0 text-tone-green" aria-hidden />
      ) : (
        <Hourglass className="size-5 shrink-0 text-tone-amber" aria-hidden />
      )}
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm font-semibold tabular-nums">{formatINR(p.amount)}</p>
        <p className="text-xs text-muted-foreground">{details.join(' · ')}</p>
      </div>
      <StatusBadge tone={paid ? 'success' : 'warning'}>{paid ? 'Received' : 'Promised'}</StatusBadge>
      <div className="flex items-center gap-1">
        {!paid && canEdit ? (
          <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ paymentId: p.id, patch: { status: 'paid' } })}>
            <CheckCircle2 /> Mark received
          </Button>
        ) : paid ? (
          <Button size="sm" variant="outline" onClick={() => void whatsappReceipt()}>
            <MessageCircle /> Send receipt
          </Button>
        ) : null}
        {canEdit && (
          <RowMenu
            label={`More for payment of ${formatINR(p.amount)}`}
            items={[
              { label: 'Edit…', icon: <Pencil className="size-4" />, onSelect: onEdit },
              ...(paid && canShareReceipt
                ? [
                    {
                      label: 'Open receipt page',
                      icon: <Receipt className="size-4" />,
                      onSelect: () => void issueReceiptLink(p.id).then((l) => l && window.open(l, '_blank', 'noopener')),
                    },
                  ]
                : []),
              {
                label: 'Delete',
                icon: <Trash2 className="size-4" />,
                onSelect: async () => {
                  if (await confirm({ title: `Delete the ${formatINR(p.amount)} payment?`, destructive: true, confirmLabel: 'Delete' })) del.mutate(p.id)
                },
              },
            ]}
          />
        )}
      </div>
    </li>
  )
}

const MODES = ['UPI', 'Cash', 'Bank transfer', 'Cheque', 'Card']

/**
 * Record or change a payment: how much, when, how, and whether it has come
 * in or is only promised. GST and a note sit under "More".
 */
function PaymentDialog({
  projectId,
  payment,
  suggested,
  onClose,
}: {
  projectId: string
  payment?: Payment | undefined
  suggested: number
  onClose: () => void
}) {
  const add = useAddPayment(projectId)
  const update = useUpdatePayment(projectId)
  const editing = !!payment
  const [amount, setAmount] = useState(payment ? String(payment.amount) : suggested > 0 ? String(suggested) : '')
  const [paidOn, setPaidOn] = useState(payment?.paid_on.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState(payment?.mode ?? 'UPI')
  const [received, setReceived] = useState((payment?.status ?? 'paid') !== 'pending')
  const [more, setMore] = useState(!!(payment?.reference || payment?.description || payment?.is_gst))
  const [reference, setReference] = useState(payment?.reference ?? '')
  const [description, setDescription] = useState(payment?.description ?? '')
  const [isGst, setIsGst] = useState(payment?.is_gst ?? false)
  const [gstNumber, setGstNumber] = useState(payment?.gst_number ?? '')
  const busy = add.isPending || update.isPending
  const value = Number(amount) || 0

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (value <= 0) return
    const body = {
      amount: value,
      paid_on: paidOn,
      mode: mode.trim() || undefined,
      status: received ? ('paid' as const) : ('pending' as const),
      reference: reference.trim() || undefined,
      description: description.trim() || undefined,
      is_gst: isGst,
      gst_number: isGst && gstNumber.trim() ? gstNumber.trim() : undefined,
    }
    if (editing) {
      update.mutate(
        { paymentId: payment.id, patch: { ...body, reference: body.reference ?? null, description: body.description ?? null, gst_number: body.gst_number ?? null } },
        { onSuccess: onClose },
      )
    } else {
      add.mutate(body, { onSuccess: onClose })
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={editing ? 'Change payment' : 'Record payment'} description={suggested > 0 && !editing ? `${formatINR(suggested)} is still to collect.` : undefined}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
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
          <div className="flex flex-col gap-1.5">
            <Label>How</Label>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
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
          {more ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-ref">Reference</Label>
                  <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-note">Note</Label>
                  <Input id="pay-note" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Advance, final settlement…" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isGst} onChange={(e) => setIsGst(e.target.checked)} />
                GST receipt
              </label>
              {isGst && <Input aria-label="GST number" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="GST number, e.g. 27ABCDE1234F1Z5" />}
            </div>
          ) : (
            <button type="button" onClick={() => setMore(true)} className="self-start text-xs font-medium text-primary hover:underline">
              + Reference, note or GST
            </button>
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

/** What the project made: value, minus crew and expenses. Only for those who see profit. */
function ProfitCard({ project }: { project: ProjectDetail }) {
  const canSee = useAccess().hasModule('financials')
  const { data } = useProjectFinancials()
  if (!canSee) return null
  const f = data?.find((x) => x.project_id === project.id)
  if (!f) return null
  const margin = f.revenue > 0 ? Math.round((f.gross_profit / f.revenue) * 100) : 0
  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="size-4 text-tone-violet" aria-hidden /> What this project makes
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fig label="Project value" value={formatINR(f.revenue)} />
          <Fig label="Crew cost" value={`− ${formatINR(f.direct_team_cost)}`} />
          <Fig label="Expenses" value={`− ${formatINR(f.project_expenses)}`} />
          <Fig
            label={`Profit${f.revenue > 0 ? ` · ${margin}%` : ''}`}
            value={formatINR(f.gross_profit)}
            className={f.gross_profit >= 0 ? 'text-tone-green' : 'text-destructive'}
          />
        </dl>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Crew cost is what you set for each person on the Shoots tab; expenses are from the Expenses tab.
        </p>
      </CardContent>
    </Card>
  )
}

function Fig({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-base font-semibold tabular-nums', className)}>{value}</dd>
    </div>
  )
}

/** Whether the client can see the quotation, and a way to open it. */
function QuotationCard({ project, canEdit }: { project: ProjectDetail; canEdit: boolean }) {
  const update = useUpdateQuotation(project.id)
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <FileText className="size-4 text-muted-foreground" aria-hidden />
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-semibold">Quotation</p>
          <p className="text-xs text-muted-foreground">
            {project.show_quotation ? 'The client can open it from their link.' : 'Hidden — the client sees a “not available” note.'}
          </p>
        </div>
        {canEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={project.show_quotation}
              onChange={(e) => update.mutate({ show_quotation: e.target.checked })}
            />
            Show to client
          </label>
        )}
        <Button variant="outline" size="sm" asChild>
          <Link to="/projects/$id/quotation" params={{ id: project.id }}>
            Open quotation
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
