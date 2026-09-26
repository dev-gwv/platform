import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { CalendarClock, Check, CheckCircle2, FileText, Hourglass, IndianRupee, MessageCircle, Pencil, Plus, Receipt, Trash2, TrendingUp } from 'lucide-react'
import type { ProjectBilling, ProjectDetail } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { RowMenu } from '@/shared/ui/row-menu'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { useDeletePayment, useProjectBilling, useUpdatePayment, useUpdateQuotation } from '@/features/projects/api'
import { useProfitAndLoss } from '@/features/financials/api'
import { issueReceiptLink, openReceiptWhatsApp, receiptShareText } from '@/features/billing/receiptShare'
import { RecordPaymentDialog, type OpenInvoice } from '@/features/billing/RecordPaymentDialog'
import { NewInvoiceDialog } from '@/features/billing/NewInvoiceDialog'
import type { InvoiceFormValues } from '@/features/billing/InvoiceForm'
import { PLAN_STATE_LABEL, planStatus } from '@/features/billing/plan'
import { dueText, shortDate } from '@/features/billing/status'
import { InvoiceBadge } from '@/features/billing/InvoiceBadge'

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
            <Plus /> Add payment from client
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
export function BillingTab({
  project,
  canEdit,
  onOpenTab,
}: {
  project: ProjectDetail
  canEdit: boolean
  onOpenTab?: ((tab: 'terms') => void) | undefined
}) {
  const access = useAccess()
  const canBill = access.hasModule('billing')
  const canInvoice = access.hasAction('billing', 'create')
  const [editing, setEditing] = useState<{ payment?: Payment; invoiceId?: string; amount?: number } | null>(null)
  const [invoicing, setInvoicing] = useState<Partial<InvoiceFormValues> | null>(null)
  const billing = useProjectBilling(project.id)
  const m = projectMoney(project)
  const payments = [...project.payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on))
  const invoices = billing.data?.invoices ?? null
  const live = (invoices ?? []).filter((i) => i.status !== 'cancelled' && i.status !== 'draft')
  const openInvoices: OpenInvoice[] = live.filter((i) => i.balance_due > 0)

  /** A new invoice for this project, with one line when it is for a part of the plan. */
  const invoiceFor = (line?: { description: string; amount: number }) =>
    setInvoicing({
      client_id: project.client_id,
      project_id: project.id,
      // Raised from the project to be sent: a draft could not be paid or shared.
      status: 'sent',
      ...(line ? { lines: [{ description: line.description, quantity: '1', rate: String(line.amount), gst_rate: 0 }] } : {}),
    })

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card>
        <CardContent className="p-4">
          <CollectionBar project={project} onRecord={canEdit ? () => setEditing({}) : undefined} />
          {canBill && live.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Invoiced {formatINR(live.reduce((n, i) => n + i.total, 0))} in {live.length} invoice{live.length === 1 ? '' : 's'}
              {openInvoices.length > 0 ? ` · ${formatINR(openInvoices.reduce((n, i) => n + i.balance_due, 0))} unpaid on them` : ' · all paid'}
            </p>
          )}
        </CardContent>
      </Card>

      <PlanCard
        project={project}
        plan={billing.data?.plan ?? null}
        loading={billing.isLoading}
        invoicedValue={live.reduce((n, i) => n + i.taxable, 0)}
        canEdit={canEdit}
        canInvoice={canInvoice}
        onRecord={(amount) => setEditing({ amount })}
        onInvoice={(description, amount) => invoiceFor({ description, amount })}
        onOpenTerms={onOpenTab ? () => onOpenTab('terms') : undefined}
      />

      {canBill && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="size-4 text-tone-blue" aria-hidden /> Invoices
                <span className="text-xs font-normal text-muted-foreground">{invoices?.length ?? 0}</span>
              </p>
              {canInvoice && (
                <Button size="sm" variant="outline" onClick={() => invoiceFor()}>
                  <Plus /> Create invoice
                </Button>
              )}
            </div>
            {!invoices || invoices.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                No invoices for this project yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {invoices.map((inv) => {
                  const due = dueText(inv)
                  return (
                    <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2">
                      <Link to="/billing/invoices/$id" params={{ id: inv.id }} className="min-w-[7rem] font-semibold text-primary hover:underline">
                        {inv.invoice_number}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {shortDate(inv.invoice_date)}
                        {due ? ` · ${due}` : ''}
                      </span>
                      <span className="ml-auto text-sm tabular-nums">
                        {formatINR(inv.total)}
                        {inv.balance_due > 0 && inv.status !== 'cancelled' && (
                          <span className="text-xs text-muted-foreground"> · {formatINR(inv.balance_due)} due</span>
                        )}
                      </span>
                      <InvoiceBadge invoice={inv} />
                      {canEdit && inv.balance_due > 0 && inv.status !== 'cancelled' && inv.status !== 'draft' && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ invoiceId: inv.id, amount: inv.balance_due })}>
                          <IndianRupee /> Record
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

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
                <Button size="sm" onClick={() => setEditing({})}>
                  <Plus /> Add payment from client
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
                  canBill={canBill}
                  onEdit={() => setEditing({ payment: p })}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ProfitCard project={project} />
      <QuotationCard project={project} canEdit={canEdit} />

      {editing && (
        <RecordPaymentDialog
          target={{ kind: 'project', projectId: project.id, invoices: canBill ? openInvoices : [], invoiceId: editing.invoiceId }}
          payment={editing.payment}
          suggested={editing.amount ?? m.due}
          onClose={() => setEditing(null)}
        />
      )}
      {invoicing && <NewInvoiceDialog initial={invoicing} openAfter={false} onClose={() => setInvoicing(null)} />}
    </div>
  )
}

/**
 * The plan the client agreed to in the terms, part by part: how much, when,
 * and whether it is in. The part due next carries the two things to do
 * about it -- invoice it, or record the money.
 */
function PlanCard({
  project,
  plan,
  loading,
  invoicedValue,
  canEdit,
  canInvoice,
  onRecord,
  onInvoice,
  onOpenTerms,
}: {
  project: ProjectDetail
  plan: ProjectBilling['plan']
  loading: boolean
  invoicedValue: number
  canEdit: boolean
  canInvoice: boolean
  onRecord: (amount: number) => void
  onInvoice: (description: string, amount: number) => void
  onOpenTerms?: (() => void) | undefined
}) {
  if (loading) return null
  if (!plan) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
          <div className="min-w-[12rem] flex-1">
            <p className="text-sm font-semibold">Payment plan</p>
            <p className="text-xs text-muted-foreground">
              No plan agreed yet. Add the instalments (like 30% advance) in the terms, and each one shows here with what has come in.
            </p>
          </div>
          {onOpenTerms && (
            <Button size="sm" variant="outline" onClick={onOpenTerms}>
              Open Terms
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }
  const m = projectMoney(project)
  const total = project.total_cost > 0 ? project.total_cost : (plan.total_cost ?? 0)
  const rows = planStatus({ instalments: plan.instalments, total, received: m.received, invoiced: invoicedValue })
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 text-tone-violet" aria-hidden /> Payment plan
          </p>
          <span className="text-xs text-muted-foreground">
            {plan.agreed_at ? `Agreed by the client on ${shortDate(plan.agreed_at)}` : 'Sent in the terms, not agreed yet'}
          </span>
        </div>
        <ol className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li
              key={r.index}
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2',
                r.state === 'received' ? 'border-border bg-tone-green-soft/30' : r.state === 'due' || r.state === 'part' ? 'border-tone-amber/50 bg-tone-amber-soft/30' : 'border-border',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  r.state === 'received' ? 'bg-tone-green text-white' : 'bg-muted text-muted-foreground',
                )}
                aria-hidden
              >
                {r.state === 'received' ? <Check className="size-3.5" /> : r.index + 1}
              </span>
              <div className="min-w-[9rem] flex-1">
                <p className="text-sm font-semibold">{r.label}</p>
                <p className="text-xs text-muted-foreground">
                  {[r.due_trigger, r.state === 'part' ? `${formatINR(r.received)} in, ${formatINR(r.remaining)} to come` : null].filter(Boolean).join(' · ') || '\u00a0'}
                </p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{formatINR(r.amount)}</span>
              <StatusBadge tone={PLAN_TONE[r.state]}>{PLAN_STATE_LABEL[r.state]}</StatusBadge>
              {(r.state === 'due' || r.state === 'part' || r.state === 'invoiced') && (
                <div className="flex w-full justify-end gap-1.5 sm:w-auto">
                  {canInvoice && r.state !== 'invoiced' && (
                    <Button size="sm" variant="outline" onClick={() => onInvoice(`${r.label} — ${project.name}`, r.remaining)}>
                      <FileText /> Invoice this
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="sm" onClick={() => onRecord(r.remaining)}>
                      <IndianRupee /> Add payment from client
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

const PLAN_TONE = { received: 'success', part: 'warning', invoiced: 'info', due: 'warning', upcoming: 'neutral' } as const

function PaymentItem({
  p,
  paid,
  project,
  canEdit,
  canBill,
  onEdit,
}: {
  p: Payment
  paid: boolean
  project: ProjectDetail
  canEdit: boolean
  canBill: boolean
  onEdit: () => void
}) {
  const update = useUpdatePayment(project.id)
  const del = useDeletePayment(project.id)
  const confirm = useConfirm()
  const navigate = useNavigate()
  const canShareReceipt = canBill

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
        <p className="text-xs text-muted-foreground">
          {details.join(' · ')}
          {p.invoice_id && p.invoice_number && (
            <>
              {details.length ? ' · ' : ''}
              {canBill ? (
                <Link to="/billing/invoices/$id" params={{ id: p.invoice_id }} className="font-medium text-primary hover:underline">
                  against {p.invoice_number}
                </Link>
              ) : (
                <>against {p.invoice_number}</>
              )}
            </>
          )}
        </p>
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
                      label: 'View receipt',
                      icon: <Receipt className="size-4" />,
                      onSelect: () => void navigate({ to: '/billing/payments/$id', params: { id: p.id } }),
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

/** What the project made: value, minus crew and expenses. Only for those who see profit. */
/**
 * The project's own profit, over its whole life, from the same statement as
 * Billing > Profit & Loss (booked: its value, its crew, its expenses) -- so
 * the two never disagree.
 */
function ProfitCard({ project }: { project: ProjectDetail }) {
  const canSee = useAccess().hasModule('financials')
  const { data } = useProfitAndLoss({ from: '2000-01-01', to: '2100-12-31', basis: 'booked', project_id: project.id }, canSee)
  if (!canSee) return null
  const f = data?.projects[0]
  if (!f) return null
  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="size-4 text-tone-violet" aria-hidden /> What this project makes
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fig label="Project value" value={formatINR(f.income)} />
          <Fig label="Crew cost" value={`− ${formatINR(f.team)}`} />
          <Fig label="Expenses" value={`− ${formatINR(f.expenses)}`} />
          <Fig
            label={`Profit${f.margin != null ? ` · ${Math.round(f.margin)}%` : ''}`}
            value={formatINR(f.profit)}
            className={f.profit >= 0 ? 'text-tone-green' : 'text-destructive'}
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
