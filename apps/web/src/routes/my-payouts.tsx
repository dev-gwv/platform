import { Link } from '@tanstack/react-router'
import { CheckCircle2, Clock } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useINR } from '@/shared/money/MoneyMask'
import { PAY_STATE_LABEL, payState, useMyPayouts } from '@/features/team-payouts/pay'
import { myPayoutsLine } from '@/features/team-payouts/crew-view'
import { todayInIndia } from '@/shared/ui/days-left'

export function MyPayoutsPage() {
  return (
    <AuthedPage module="dashboard">
      <MyPayouts />
    </AuthedPage>
  )
}

const day = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date yet'

/**
 * A freelancer's (or anyone's) shoot money: what each booking pays, what the
 * studio has paid and when -- so "did you pay for the Mehta wedding?" is
 * answered without a call.
 */
function MyPayouts() {
  const inr = useINR()
  const q = useMyPayouts()
  const today = todayInIndia()
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My payouts" />
      {q.isLoading ? (
        <SkeletonList rows={4} columns={3} />
      ) : q.isError || !q.data ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.bookings.length === 0 ? (
        <EmptyState title="No shoots yet" description="When the studio books you on a shoot, what it pays shows here." />
      ) : (
        <>
          <Card className={q.data.owed_now > 0 ? 'border-warning/40' : q.data.upcoming > 0 ? '' : 'border-success/40 bg-success/5'}>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              {q.data.owed_now > 0 || q.data.upcoming > 0 ? (
                <Clock className={q.data.owed_now > 0 ? 'size-5 text-warning' : 'size-5 text-muted-foreground'} aria-hidden />
              ) : (
                <CheckCircle2 className="size-5 text-success" aria-hidden />
              )}
              <p className="min-w-0 flex-1 text-sm">{myPayoutsLine(q.data)}</p>
            </CardContent>
          </Card>

          {!q.data.has_pay_details && (
            <p className="rounded-lg border border-dashed border-warning/60 bg-warning/[0.06] p-3 text-sm">
              Add your UPI or bank account so the studio can pay you.{' '}
              <Link to="/profile" className="font-medium text-primary hover:underline">
                Add it on My profile →
              </Link>
            </p>
          )}

          <Card>
            <CardContent className="flex flex-col divide-y divide-border p-0">
              {q.data.bookings.map((b) => {
                const state = payState(b.amount, b.paid)
                // Before the shoot nothing is late: money owed reads "After the shoot", money paid "Paid in advance".
                const ahead = !b.shoot_date || b.shoot_date >= today
                return (
                  <div key={b.slot_id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', state === 'paid' && 'bg-success/[0.06]')}>
                    <div className="min-w-[10rem] flex-1">
                      <p className="text-sm font-medium">{[b.shoot_name, b.project_name].filter(Boolean).join(' · ') || 'A shoot'}</p>
                      <p className="text-xs text-muted-foreground">{[day(b.shoot_date), b.role].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{b.amount > 0 ? inr(b.amount) : 'Not set yet'}</p>
                      <p className="text-xs text-muted-foreground">
                        {state === 'part' ? `${inr(b.paid)} paid` : b.amount > 0 && !b.is_final ? 'may change' : ' '}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs font-medium',
                        state === 'paid' && 'bg-success/15 text-success',
                        (state === 'due' || state === 'part') && !ahead && 'bg-warning/15 text-warning',
                        (state === 'due' || state === 'part') && ahead && 'bg-muted text-muted-foreground',
                        state === 'no_amount' && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {state === 'no_amount'
                        ? 'Waiting for amount'
                        : ahead && state === 'paid'
                          ? 'Paid in advance'
                          : ahead && state === 'due'
                            ? 'After the shoot'
                            : PAY_STATE_LABEL[state]}
                    </span>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {q.data.payments.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Payments</h2>
              <Card>
                <CardContent className="flex flex-col divide-y divide-border p-0">
                  {q.data.payments.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-[7rem] text-muted-foreground">{day(p.paid_date)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {p.shoot_name ?? 'A shoot'}
                        {p.payment_mode ? ` · ${p.payment_mode}` : ''}
                        {p.payment_reference ? ` · ${p.payment_reference}` : ''}
                      </span>
                      <span className={cn('font-semibold tabular-nums', p.amount < 0 && 'text-destructive')}>
                        {p.amount < 0 ? `−${inr(-p.amount)} (corrected)` : inr(p.amount)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
