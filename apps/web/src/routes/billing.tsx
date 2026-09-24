import { useState } from 'react'
import { Link, Navigate } from '@tanstack/react-router'
import { AlarmClock, ArrowRight, CalendarClock, FileText, IndianRupee, MessageCircle, Plus, Wallet } from 'lucide-react'
import type { BillingDueInvoice, BillingOverview } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useBillingOverview } from '@/features/billing/api'
import { NewInvoiceDialog } from '@/features/billing/NewInvoiceDialog'
import { RecordPaymentDialog } from '@/features/billing/RecordPaymentDialog'
import { dueText, invoiceBadge, isOverdue, shortDate } from '@/features/billing/status'
import { whatsappInvoice } from '@/features/billing/share'

export function BillingPage({ newInvoice }: { newInvoice?: boolean } = {}) {
  // Old links: /billing?tab=payments was the payments list.
  if (new URLSearchParams(window.location.search).get('tab') === 'payments') return <Navigate to="/billing/payments" replace />
  return (
    <AuthedPage module="billing">
      <Overview newInvoice={newInvoice} />
    </AuthedPage>
  )
}

/**
 * Billing, the studio-wide view: what is still owed across every project,
 * which invoices are late or nearly due (with a one-tap reminder), and what
 * came in lately. Every row leads to its project or invoice -- this is the
 * same money the project pages show, gathered in one place.
 */
function Overview({ newInvoice }: { newInvoice?: boolean | undefined }) {
  const { data, isLoading, isError, refetch } = useBillingOverview()
  const canInvoice = useAccess().hasAction('billing', 'create')
  const [creating, setCreating] = useState(!!newInvoice)

  return (
    <>
      <PageHeader
        title="Billing"
        description="What clients owe, what is late, and what has come in."
        actions={
          canInvoice && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New invoice
            </Button>
          )
        }
      />
      {creating && <NewInvoiceDialog onClose={() => setCreating(false)} />}
      {isLoading ? (
        <SkeletonCards count={4} />
      ) : isError || !data ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <Headline data={data} />
          <div className="grid gap-4 lg:grid-cols-5">
            <DueInvoices rows={data.due_invoices} className="lg:col-span-3" />
            <MonthlyCard monthly={data.monthly} className="lg:col-span-2" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ProjectsToCollect rows={data.projects_to_collect} />
            <RecentPayments rows={data.recent_payments} />
          </div>
        </div>
      )}
    </>
  )
}

function Headline({ data }: { data: BillingOverview }) {
  const tiles = [
    {
      label: 'Still to collect',
      value: formatINR(data.to_collect),
      hint: 'Across every project',
      icon: Wallet,
      tone: 'text-tone-blue bg-tone-blue-soft',
      to: '/projects' as const,
    },
    {
      label: 'Overdue',
      value: formatINR(data.overdue.amount),
      hint: data.overdue.count ? `${data.overdue.count} invoice${data.overdue.count === 1 ? '' : 's'} past due` : 'Nothing late',
      icon: AlarmClock,
      tone: data.overdue.count ? 'text-destructive bg-destructive/10' : 'text-tone-green bg-tone-green-soft',
      to: '/billing/invoices' as const,
      search: 'status=overdue',
    },
    {
      label: 'Received this month',
      value: formatINR(data.received_this_month),
      hint: data.due_soon.count ? `${formatINR(data.due_soon.amount)} due in the next 7 days` : 'Nothing due this week',
      icon: IndianRupee,
      tone: 'text-tone-green bg-tone-green-soft',
      to: '/billing/payments' as const,
    },
    {
      label: 'Invoiced this month',
      value: formatINR(data.invoiced_this_month),
      hint: 'Sent invoices, before payments',
      icon: FileText,
      tone: 'text-tone-violet bg-tone-violet-soft',
      to: '/billing/invoices' as const,
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <a
          key={t.label}
          href={t.search ? `${t.to}?${t.search}` : t.to}
          className="group rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 sm:p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{t.label}</p>
              <p className="mt-1 truncate text-xl font-semibold tabular-nums tracking-tight">{t.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
            </div>
            <span className={cn('hidden rounded-md p-2 sm:inline-flex', t.tone)}>
              <t.icon className="size-5" />
            </span>
          </div>
        </a>
      ))}
    </div>
  )
}

/** Invoices with money owed, late ones first, each with a reminder and a way to record the payment. */
function DueInvoices({ rows, className }: { rows: BillingDueInvoice[]; className?: string }) {
  const access = useAccess()
  const canRecord = access.hasAction('billing', 'edit')
  const [recording, setRecording] = useState<BillingDueInvoice | null>(null)
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold tracking-tight">
            <CalendarClock className="size-4 text-tone-amber" aria-hidden /> Waiting to be paid
          </h2>
          <Link to="/billing/invoices" className="text-xs font-medium text-primary hover:underline">
            All invoices
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Every sent invoice is paid. 🎉
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((inv) => {
              const late = isOverdue(inv)
              const badge = invoiceBadge(inv)
              return (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                  <div className="min-w-[12rem] flex-1">
                    <p className="text-sm font-medium">
                      <Link to="/billing/invoices/$id" params={{ id: inv.id }} className="hover:underline">
                        {inv.invoice_number}
                      </Link>
                      <span className="text-muted-foreground"> · {inv.client_name ?? 'No client'}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {inv.project_id ? (
                        <Link to="/projects/$id" params={{ id: inv.project_id }} search={{ tab: 'billing' }} className="hover:underline">
                          {inv.project_name}
                        </Link>
                      ) : (
                        'No project'
                      )}
                      <span className={cn(late && 'font-medium text-destructive')}> · {dueText(inv) ?? `Sent ${shortDate(inv.invoice_date)}`}</span>
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatINR(inv.balance_due)}</span>
                  <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => void whatsappInvoice(inv, true)} title="Send a WhatsApp reminder with the invoice link">
                      <MessageCircle /> Remind
                    </Button>
                    {canRecord && (
                      <Button size="sm" variant="ghost" onClick={() => setRecording(inv)} aria-label={`Record payment on ${inv.invoice_number}`}>
                        <IndianRupee /> Record
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      {recording && (
        <RecordPaymentDialog
          target={{ kind: 'invoice', invoiceId: recording.id, invoiceNumber: recording.invoice_number }}
          suggested={recording.balance_due}
          onClose={() => setRecording(null)}
        />
      )}
    </Card>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Six months of invoiced against received, side by side. */
function MonthlyCard({ monthly, className }: { monthly: BillingOverview['monthly']; className?: string }) {
  const max = Math.max(1, ...monthly.flatMap((m) => [m.invoiced, m.received]))
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <h2 className="font-semibold tracking-tight">The last six months</h2>
        <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-tone-violet" aria-hidden /> Invoiced
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-tone-green" aria-hidden /> Received
          </span>
        </div>
        <div className="mt-4 flex h-36 items-end gap-2" role="img" aria-label="Invoiced and received, month by month">
          {monthly.map((m) => (
            <div key={m.month} className="flex h-full flex-1 flex-col justify-end">
              <div className="flex h-full items-end justify-center gap-0.5">
                {(['invoiced', 'received'] as const).map((k) => (
                  <span
                    key={k}
                    title={`${MONTHS[Number(m.month.slice(5, 7)) - 1]}: ${k} ${formatINR(m[k])}`}
                    style={{ height: `${Math.max((m[k] / max) * 100, m[k] > 0 ? 2 : 0)}%` }}
                    className={cn('w-1/2 max-w-4 rounded-t', k === 'invoiced' ? 'bg-tone-violet/80' : 'bg-tone-green/80', m[k] === 0 && 'h-px bg-border')}
                  />
                ))}
              </div>
              <span className="mt-1 text-center text-[0.65rem] text-muted-foreground">{MONTHS[Number(m.month.slice(5, 7)) - 1]}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/** The projects with the most still to come in, each a link to its Billing tab. */
function ProjectsToCollect({ rows }: { rows: BillingOverview['projects_to_collect'] }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold tracking-tight">
          <Wallet className="size-4 text-tone-blue" aria-hidden /> Projects with money to collect
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every project is fully paid.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((p) => {
              const pct = p.total_cost > 0 ? Math.min(100, Math.round((p.received / p.total_cost) * 100)) : 0
              return (
                <li key={p.project_id}>
                  <Link
                    to="/projects/$id"
                    params={{ id: p.project_id }}
                    search={{ tab: 'billing' }}
                    className="group block rounded-md border border-border px-3 py-2 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium group-hover:underline">{p.project_name}</p>
                      <p className="shrink-0 text-sm font-semibold tabular-nums">{formatINR(p.due)}</p>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-tone-green" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>
                        {p.client_name ?? '—'} · {formatINR(p.received)} of {formatINR(p.total_cost)}
                      </span>
                      <span>{p.invoiced_open > 0 ? `${formatINR(p.invoiced_open)} invoiced` : 'Not invoiced'}</span>
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function RecentPayments({ rows }: { rows: BillingOverview['recent_payments'] }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold tracking-tight">
            <IndianRupee className="size-4 text-tone-green" aria-hidden /> Recently received
          </h2>
          <Link to="/billing/payments" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            All payments <ArrowRight className="size-3" />
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{shortDate(r.paid_on)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {r.project_id ? (
                      <Link to="/projects/$id" params={{ id: r.project_id }} search={{ tab: 'billing' }} className="hover:underline">
                        {r.project_name}
                      </Link>
                    ) : (
                      (r.client_name ?? '—')
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[r.mode, r.invoice_number ? `against ${r.invoice_number}` : null].filter(Boolean).join(' · ') || ' '}
                  </p>
                </div>
                <span className="font-semibold tabular-nums text-tone-green">{formatINR(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
