import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, CalendarClock, Check, CheckCircle2, FileText, Hourglass, IndianRupee, Link2, MessageCircle, Pencil, Plus, Receipt, Trash2, TrendingUp } from 'lucide-react'
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
import { nextInvoiceFromPlan } from '@/features/billing/from-plan'
import { dueText, isOverdue, shortDate } from '@/features/billing/status'
import { projectMoneyChecks, type MoneyCheck } from '@/features/billing/project-money'
import { IconTile } from '@/shared/ui/icon-tile'
import { waLink } from '@ipc/domain'
import { InvoiceBadge } from '@/features/billing/InvoiceBadge'

type Payment = ProjectDetail['payments'][number]
type BillingInvoice = NonNullable<ProjectBilling['invoices']>[number]

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

/** First name for a friendly line: "Rahul" from "Rahul Sharma". */
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'The client'

/**
 * The money in one sentence and one bar: paid (green), promised (amber),
 * still to collect (grey). The page header already carries the three
 * numbers; this says what they mean.
 */
export function MoneyStory({
  project,
  onRecord,
}: {
  project: ProjectDetail
  onRecord?: (() => void) | undefined
}) {
  const m = projectMoney(project)
  const who = firstName(project.client_name)
  const pct = (n: number) => `${m.total > 0 ? Math.min(100, (n / m.total) * 100) : 0}%`
  const remind =
    m.due > 0 && project.client_phone
      ? waLink(
          project.client_phone,
          `Hi ${who}, a gentle reminder that ${formatINR(m.due)} is still due for ${project.name}. Thank you!`,
        )
      : null
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 text-base leading-relaxed">
            {m.total <= 0 ? (
              <>No price set for this project yet.</>
            ) : m.due <= 0 ? (
              <>
                <span className="font-semibold">{who}</span> has paid in full:{' '}
                <span className="font-semibold text-tone-green">{formatINR(m.received)}</span>. Nothing left to collect.
              </>
            ) : (
              <>
                <span className="font-semibold">{who}</span> has paid{' '}
                <span className="font-semibold text-tone-green">{formatINR(m.received)}</span> of{' '}
                <span className="font-semibold">{formatINR(m.total)}</span>.{' '}
                <span className="font-semibold text-tone-amber">{formatINR(m.due)}</span> left to collect.
              </>
            )}
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            {remind && (
              <Button variant="outline" size="sm" asChild>
                <a href={remind} target="_blank" rel="noreferrer">
                  <MessageCircle /> Remind on WhatsApp
                </a>
              </Button>
            )}
            {onRecord && (
              <Button size="sm" onClick={onRecord}>
                <Plus /> Record payment
              </Button>
            )}
          </div>
        </div>
        <div
          className="flex h-3 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={m.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Collected"
        >
          <div className="h-full bg-tone-green transition-[width] duration-500" style={{ width: pct(m.received) }} />
          <div
            className="h-full bg-tone-amber/60 transition-[width] duration-500"
            style={{ width: pct(Math.min(m.promised, m.due)), backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 4px, rgb(255 255 255 / 0.35) 4px 8px)' }}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Legend className="bg-tone-green" label={`Paid ${formatINR(m.received)}`} />
          {m.promised > 0 && <Legend className="bg-tone-amber/60" label={`Promised ${formatINR(m.promised)}`} />}
          {m.due > 0 && <Legend className="bg-muted-foreground/30" label={`To collect ${formatINR(m.due)}`} />}
          <span>
            Package {formatINR(project.package_cost)}
            {project.additional_deliverables_cost > 0 ? ` + extras ${formatINR(project.additional_deliverables_cost)}` : ''}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-full', className)} aria-hidden />
      {label}
    </span>
  )
}

/**
 * The one or two things on this project's money that need a look, each with
 * its fix -- instead of numbers that silently disagree.
 */
function NeedsALook({
  project,
  checks,
  canEdit,
  onRecord,
}: {
  project: ProjectDetail
  checks: MoneyCheck[]
  canEdit: boolean
  onRecord: (invoiceId: string, amount: number) => void
}) {
  const attach = useUpdatePayment(project.id)
  if (checks.length === 0) return null
  return (
    <Card className="border-tone-amber/40 bg-tone-amber-soft/40">
      <CardContent className="flex flex-col gap-2 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="size-4 text-tone-amber" aria-hidden /> Needs a look
        </p>
        <ul className="flex flex-col gap-2">
          {checks.slice(0, 2).map((c) => (
            <li key={c.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <span className="min-w-0 flex-1">
                {c.kind === 'unlinked' ? (
                  <>
                    {formatINR(c.amount)} received isn’t attached to <b>{c.invoiceNumber}</b>, so that invoice still shows it as unpaid.
                  </>
                ) : c.kind === 'over_invoiced' ? (
                  <>
                    Invoices add up to <b>{formatINR(c.invoiced)}</b>, which is {formatINR(c.invoiced - c.agreed)} more than the project’s{' '}
                    {formatINR(c.agreed)}.
                  </>
                ) : (
                  <>
                    <b>{c.invoiceNumber}</b> is {c.late}, with {formatINR(c.balance)} unpaid.
                  </>
                )}
              </span>
              {c.kind === 'unlinked' && canEdit ? (
                <Button
                  size="sm"
                  disabled={attach.isPending}
                  onClick={() => attach.mutate({ paymentId: c.paymentId, patch: { invoice_id: c.invoiceId } })}
                >
                  <Link2 /> Attach it
                </Button>
              ) : c.kind === 'overdue' && canEdit ? (
                <Button size="sm" onClick={() => onRecord(c.invoiceId, c.balance)}>
                  <IndianRupee /> Record payment
                </Button>
              ) : (
                <Button size="sm" variant="outline" asChild>
                  <Link to="/billing/invoices/$id" params={{ id: c.invoiceId }}>
                    Open {c.invoiceNumber}
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/**
 * Billing: what the money says, what needs a look, and every invoice and
 * payment on one line each, newest first.
 */
export function BillingTab({
  project,
  canEdit,
  onOpenTab,
  invoiceNext = false,
  onInvoiceNextDone,
  onBookTeam,
}: {
  project: ProjectDetail
  canEdit: boolean
  onOpenTab?: ((tab: 'terms') => void) | undefined
  /** Open the next instalment's invoice straight away (the journey's "Create the invoice"). */
  invoiceNext?: boolean
  onInvoiceNextDone?: (() => void) | undefined
  /** The step after the invoice. */
  onBookTeam?: (() => void) | undefined
}) {
  const access = useAccess()
  const canBill = access.hasModule('billing')
  const canInvoice = access.hasAction('billing', 'create')
  const [editing, setEditing] = useState<{ payment?: Payment; invoiceId?: string; amount?: number } | null>(null)
  const [invoicing, setInvoicing] = useState<Partial<InvoiceFormValues> | null>(null)
  const billing = useProjectBilling(project.id)
  const m = projectMoney(project)
  const invoices = billing.data?.invoices ?? null
  const live = (invoices ?? []).filter((i) => i.status !== 'cancelled' && i.status !== 'draft')
  const openInvoices: OpenInvoice[] = live.filter((i) => i.balance_due > 0)
  const checks = canBill && invoices ? projectMoneyChecks(project.total_cost, invoices, project.payments) : []

  /** A new invoice for this project, with one line when it is for a part of the plan. */
  const invoiceFor = (line?: { description: string; amount: number }) =>
    setInvoicing({
      client_id: project.client_id,
      project_id: project.id,
      // Raised from the project to be sent: a draft could not be paid or shared.
      status: 'sent',
      ...(line ? { lines: [{ description: line.description, quantity: '1', rate: String(line.amount), gst_rate: 0 }] } : {}),
    })

  // "Create the invoice" from the journey: the booking amount (or whichever
  // part of the plan is next), already filled in -- client, project, subject,
  // one line at the right amount. The studio checks it and presses Save.
  const plan = billing.data?.plan ?? null
  // Opened by the journey: saving it goes straight on to booking the team.
  const [fromJourney, setFromJourney] = useState(false)
  useEffect(() => {
    if (!invoiceNext || billing.isLoading) return
    onInvoiceNextDone?.()
    if (!canBill || !canInvoice) return
    setFromJourney(true)
    const next = nextInvoiceFromPlan({
      projectName: project.name,
      total: plan?.total_cost ?? project.total_cost,
      instalments: plan?.instalments ?? null,
      received: m.received,
      invoiced: live.reduce((n, i) => n + i.taxable, 0),
    })
    setInvoicing({
      client_id: project.client_id,
      project_id: project.id,
      status: 'sent',
      ...(next
        ? {
            subject: next.description,
            lines: [{ description: next.description, quantity: '1', rate: String(next.amount), gst_rate: 0 }],
          }
        : {}),
    })
  }, [invoiceNext, billing.isLoading])

  // Invoices and payments on one timeline, newest first.
  const rows: Array<{ kind: 'invoice'; at: string; inv: BillingInvoice } | { kind: 'payment'; at: string; p: Payment }> = [
    ...(canBill ? (invoices ?? []).map((inv) => ({ kind: 'invoice' as const, at: inv.invoice_date, inv })) : []),
    ...project.payments.map((p) => ({ kind: 'payment' as const, at: p.paid_on, p })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div className="mt-4 flex flex-col gap-4">
      <MoneyStory project={project} onRecord={canEdit ? () => setEditing({}) : undefined} />

      <NeedsALook project={project} checks={checks} canEdit={canEdit} onRecord={(invoiceId, amount) => setEditing({ invoiceId, amount })} />

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

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Money in and out</p>
            {canBill && canInvoice && (
              <Button size="sm" variant="outline" onClick={() => invoiceFor()}>
                <Plus /> Create invoice
              </Button>
            )}
          </div>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
              <IconTile icon={IndianRupee} tone="green" size="lg" />
              <p className="text-sm text-muted-foreground">Nothing yet. Record the advance when it comes in.</p>
              {canEdit && (
                <Button size="sm" onClick={() => setEditing({})}>
                  <Plus /> Record payment
                </Button>
              )}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) =>
                r.kind === 'invoice' ? (
                  <InvoiceItem
                    key={`i-${r.inv.id}`}
                    inv={r.inv}
                    canEdit={canEdit}
                    onRecord={() => setEditing({ invoiceId: r.inv.id, amount: r.inv.balance_due })}
                  />
                ) : (
                  <PaymentItem
                    key={`p-${r.p.id}`}
                    p={r.p}
                    paid={m.isPaid(r.p)}
                    project={project}
                    canEdit={canEdit}
                    canBill={canBill}
                    onEdit={() => setEditing({ payment: r.p })}
                  />
                ),
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ProfitCard project={project} />
        <QuotationCard project={project} canEdit={canEdit} />
      </div>

      {editing && (
        <RecordPaymentDialog
          target={{ kind: 'project', projectId: project.id, invoices: canBill ? openInvoices : [], invoiceId: editing.invoiceId }}
          payment={editing.payment}
          suggested={editing.amount ?? m.due}
          onClose={() => setEditing(null)}
        />
      )}
      {invoicing && (
        <NewInvoiceDialog
          initial={invoicing}
          openAfter={false}
          onClose={() => {
            setInvoicing(null)
            setFromJourney(false)
          }}
          next={onBookTeam ? { label: 'Book the team', onClick: onBookTeam, auto: fromJourney } : undefined}
        />
      )}
    </div>
  )
}

/** One invoice on the timeline: blue when out, red when late, green once paid. */
function InvoiceItem({
  inv,
  canEdit,
  onRecord,
}: {
  inv: BillingInvoice
  canEdit: boolean
  onRecord: () => void
}) {
  const due = dueText(inv)
  const late = isOverdue(inv)
  const paid = inv.balance_due <= 0 && inv.status !== 'draft' && inv.status !== 'cancelled'
  const open = inv.balance_due > 0 && inv.status !== 'cancelled' && inv.status !== 'draft'
  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5', late ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-card')}>
      <IconTile icon={late ? AlertTriangle : FileText} tone={paid ? 'green' : late ? 'rose' : 'blue'} />
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm">
          <span className="text-muted-foreground">Invoice </span>
          <Link to="/billing/invoices/$id" params={{ id: inv.id }} className="font-semibold text-primary hover:underline">
            {inv.invoice_number}
          </Link>
          <span className="font-semibold tabular-nums"> · {formatINR(inv.total)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {shortDate(inv.invoice_date)}
          {due ? ` · ${due}` : ''}
          {open && inv.balance_due < inv.total ? ` · ${formatINR(inv.balance_due)} still due` : ''}
        </p>
      </div>
      <InvoiceBadge invoice={inv} />
      {canEdit && open && (
        <Button size="sm" variant="outline" onClick={onRecord}>
          <IndianRupee /> Record
        </Button>
      )}
    </li>
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
    // No plan is not a problem to fill a card with: one quiet line.
    return (
      <p className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-tone-violet" aria-hidden />
        <span>
          No payment plan yet (like 30% advance, the rest before delivery).{' '}
          {onOpenTerms && (
            <button type="button" onClick={onOpenTerms} className="font-medium text-primary hover:underline">
              Add it in Terms
            </button>
          )}
        </span>
      </p>
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
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5', paid ? 'border-border bg-card' : 'border-tone-amber/40 bg-tone-amber-soft/30')}>
      <IconTile icon={paid ? IndianRupee : Hourglass} tone={paid ? 'green' : 'amber'} />
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm">
          <span className="text-muted-foreground">{paid ? 'Payment received ' : 'Payment promised '}</span>
          <span className="font-semibold tabular-nums">{formatINR(p.amount)}</span>
        </p>
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
          <IconTile icon={TrendingUp} tone="violet" size="sm" /> What this project makes
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
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
        <IconTile icon={FileText} tone="blue" size="sm" />
        <div className="min-w-[10rem] flex-1">
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
