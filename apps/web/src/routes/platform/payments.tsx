import { CheckCircle2, CreditCard } from 'lucide-react'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useCreditPayment, usePaymentRecovery } from '@/features/platform/api'

export function PlatformPaymentsPage() {
  return (
    <PlatformPage>
      <Payments />
    </PlatformPage>
  )
}

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * A studio paid and did not get its plan: the browser closed before the
 * payment was confirmed, and the webhook never matched. Each order here was
 * started over ten minutes ago and is still unpaid on our side. "Credit"
 * asks Razorpay (or the webhook ledger) for the captured payment first, so
 * nothing is credited that Razorpay did not take.
 */
function Payments() {
  const q = usePaymentRecovery()
  const credit = useCreditPayment()

  return (
    <>
      <PageHeader title="Payments to check" />
      {q.isLoading ? (
        <SkeletonList rows={4} columns={4} />
      ) : q.isError || !q.data ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="p-3">
              <p className="px-1 pb-2 text-sm font-semibold">
                Unfinished orders <span className="font-normal text-muted-foreground">{q.data.stuck.length}</span>
              </p>
              {q.data.stuck.length === 0 ? (
                <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-success" aria-hidden /> Every order in the last 60 days was either paid and credited, or never paid.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {q.data.stuck.map((o) => (
                    <li key={o.order_id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                      <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-[12rem] flex-1">
                        <p className="text-sm font-medium">
                          {o.company_name ?? 'A studio'} · {o.plan_name ?? 'plan'} · {formatINR(o.amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Started {when(o.created_at)} · {o.razorpay_order_id}
                          {o.captured_payment_id ? ' · Razorpay reported it paid' : ''}
                        </p>
                      </div>
                      {o.captured_payment_id || q.data.can_check ? (
                        <Button size="sm" className={o.captured_payment_id ? 'ipc-nudge' : undefined} disabled={credit.isPending} onClick={() => credit.mutate(o.order_id)}>
                          {o.captured_payment_id ? 'Credit the plan' : 'Check & credit'}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Set Razorpay keys to check</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {q.data.unmatched.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <p className="px-1 pb-1 text-sm font-semibold">Payments for orders we do not know</p>
                <p className="px-1 pb-2 text-xs text-muted-foreground">Taken by Razorpay on an order this app never made. Match them by email in the Razorpay dashboard.</p>
                <ul className="flex flex-col gap-1.5">
                  {q.data.unmatched.map((u) => (
                    <li key={u.event_id} className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {u.amount != null ? formatINR(u.amount) : '—'} · {u.email ?? 'no email'} · {u.payment_id ?? ''}
                      </span>
                      <span className="text-xs text-muted-foreground">{when(u.processed_at)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  )
}
