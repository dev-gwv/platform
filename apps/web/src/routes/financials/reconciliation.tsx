import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Banknote, CheckCircle2, FileText, Landmark, Users, Wallet } from 'lucide-react'
import type { ReconciliationSummary } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Button } from '@/shared/ui/button'
import { SkeletonTiles } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { useReconciliation } from '@/features/financials/api'

/**
 * Reconciliation.
 *
 * Every figure here is a difference between two numbers worked out
 * independently: what was sold against what was billed, what was billed
 * against what came in, what came in against what the bank confirmed, what is
 * owed to the team against what has been settled.
 *
 * That is the whole point of the page. Two money bugs in this system survived
 * for months because the two halves of the same rupee were never displayed
 * together — each screen was self-consistent, so each looked right. Here a
 * disagreement is a column, and a column is hard to miss.
 */
export function ReconciliationPage() {
  return (
    <AuthedPage module="financials">
      <Reconciliation />
    </AuthedPage>
  )
}

function Reconciliation() {
  const { data, isLoading, isError, refetch } = useReconciliation()
  const isMobile = useIsMobile()

  if (isLoading) return <SkeletonTiles count={8} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const { money_in: inn, money_out: out, health } = data
  const problems = Object.entries(health).filter(([, v]) => v > 0)

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Sold against billed, billed against received, received against banked, owed against settled. Anything that does not line up shows here."
      />

      <HealthStrip problems={problems} />

      {/* ── Money in ──────────────────────────────────────────── */}
      <h2 className="mt-6 text-sm font-semibold text-muted-foreground">Money in</h2>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sold" value={formatINR(inn.project_value)} icon={FileText} hint="Value of every live project" />
        <StatCard label="Invoiced" value={formatINR(inn.invoiced)} icon={FileText} hint="Sent, partial and paid bills" />
        <StatCard label="Received" value={formatINR(inn.received)} icon={Wallet} hint="Payments the studio has recorded" />
        <StatCard label="Banked" value={formatINR(inn.banked)} icon={Landmark} hint="Confirmed as reaching the account" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Difference
          label="Not yet billed"
          value={inn.unbilled}
          tone="warning"
          explain="Work sold that no invoice covers. The quietest way a studio loses money: the job is done, the client would pay, and nobody sent the bill."
        />
        <Difference
          label="Owed by clients"
          value={inn.outstanding}
          tone="warning"
          explain="Invoiced and not yet received."
        />
        <Difference
          label="Not confirmed in the bank"
          value={inn.unbanked}
          tone={inn.unbanked > 0 ? 'danger' : 'neutral'}
          explain="Recorded as received but nobody has confirmed it landed — a cheque that never cleared lives here."
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Projects that do not line up ({inn.projects.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {inn.projects.length === 0 ? (
            <EmptyState
              title="Everything is billed, received and banked"
              description="Projects appear here only when one of those three disagrees with another."
            />
          ) : isMobile ? (
            <RecordCards>
              {inn.projects.map((p) => (
                <RecordCard
                  key={p.project_id}
                  title={<Link to="/projects/$id" params={{ id: p.project_id }} className="hover:underline">{p.name}</Link>}
                  fields={[
                    { label: 'Sold', value: formatINR(p.project_value) },
                    { label: 'Invoiced', value: formatINR(p.invoiced) },
                    { label: 'Received', value: formatINR(p.received) },
                    { label: 'Banked', value: formatINR(p.banked) },
                    { label: 'Not billed', value: formatINR(p.unbilled), strong: p.unbilled > 0 },
                    { label: 'Owed', value: formatINR(p.outstanding), strong: p.outstanding > 0 },
                  ]}
                />
              ))}
            </RecordCards>
          ) : (
            <div className="table-wrap rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-2 font-medium">Project</th>
                    <th className="p-2 text-right font-medium">Sold</th>
                    <th className="p-2 text-right font-medium">Invoiced</th>
                    <th className="p-2 text-right font-medium">Received</th>
                    <th className="p-2 text-right font-medium">Banked</th>
                    <th className="p-2 text-right font-medium">Not billed</th>
                    <th className="p-2 text-right font-medium">Owed</th>
                  </tr>
                </thead>
                <tbody>
                  {inn.projects.map((p) => (
                    <tr key={p.project_id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-2">
                        <Link to="/projects/$id" params={{ id: p.project_id }} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground">{formatINR(p.project_value)}</td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground">{formatINR(p.invoiced)}</td>
                      <td className="p-2 text-right tabular-nums">{formatINR(p.received)}</td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground">{formatINR(p.banked)}</td>
                      <td className={`p-2 text-right tabular-nums ${p.unbilled > 0 ? 'font-semibold text-warning' : 'text-muted-foreground'}`}>
                        {formatINR(p.unbilled)}
                      </td>
                      <td className={`p-2 text-right tabular-nums ${p.outstanding > 0 ? 'font-semibold' : 'text-muted-foreground'}`}>
                        {formatINR(p.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Money out ─────────────────────────────────────────── */}
      <h2 className="mt-8 text-sm font-semibold text-muted-foreground">Money out</h2>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Owed to the team" value={formatINR(out.due)} icon={Users} hint="Every live booking, at its cost" />
        <StatCard label="Settled" value={formatINR(out.settled)} icon={Banknote} hint="Paid out, reversals subtracted" />
        <StatCard label="Still to pay" value={formatINR(out.outstanding)} icon={Wallet} />
        <StatCard label="Paid over" value={formatINR(out.overpaid)} icon={AlertTriangle} hint="Settled beyond what the booking was costed at" />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Team ({out.members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {out.members.length === 0 ? (
            <EmptyState title="Nobody is owed anything" description="Members appear here once they are booked on a costed shoot." />
          ) : (
            <ul className="divide-y divide-border">
              {out.members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="font-medium">{m.name ?? 'Member'}</span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                    <span className="text-muted-foreground">{formatINR(m.due)} owed</span>
                    <span className="text-muted-foreground">{formatINR(m.settled)} settled</span>
                    {m.outstanding > 0 && <StatusBadge tone="warning">{formatINR(m.outstanding)} to pay</StatusBadge>}
                    {m.overpaid > 0 && <StatusBadge tone="danger">{formatINR(m.overpaid)} over</StatusBadge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Button variant="outline" size="sm" asChild>
              <Link to="/team-payouts">
                Settle payouts <ArrowRight />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

/** One difference, with the sentence that says why it matters. */
function Difference({
  label,
  value,
  tone,
  explain,
}: {
  label: string
  value: number
  tone: 'warning' | 'danger' | 'neutral'
  explain: string
}) {
  const colour = value <= 0 ? 'text-muted-foreground' : tone === 'danger' ? 'text-destructive' : 'text-warning'
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${colour}`}>{formatINR(value)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{explain}</p>
    </div>
  )
}

const HEALTH_COPY: Record<keyof ReconciliationSummary['health'], string> = {
  payments_linked_to_nothing: 'payment(s) belong to neither a project nor an invoice',
  invoices_paid_with_balance: 'invoice(s) marked paid that still show a balance',
  invoices_unpaid_but_settled: 'unsent invoice(s) that money has been recorded against',
  payments_client_mismatch: 'payment(s) filed against a client who is not on the project',
}

/**
 * Rules the database is supposed to hold, counted rather than assumed.
 *
 * Silence here is the normal state. It is worth the row of pixels because the
 * day one of these stops being true is the day somebody needs to know, and
 * every one of them has a fix rather than a shrug.
 */
function HealthStrip({ problems }: { problems: [string, number][] }) {
  if (problems.length === 0) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        <span>Every consistency check passes.</span>
      </div>
    )
  }
  return (
    <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" role="status">
      <p className="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {problems.length} consistency check{problems.length === 1 ? '' : 's'} failed
      </p>
      <ul className="mt-1.5 list-disc pl-6">
        {problems.map(([key, count]) => (
          <li key={key}>
            {count} {HEALTH_COPY[key as keyof ReconciliationSummary['health']] ?? key}
          </li>
        ))}
      </ul>
    </div>
  )
}
