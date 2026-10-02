import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HardDrive } from 'lucide-react'
import type { ProjectPayoutRow } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { RoleTile } from '@/shared/ui/icon-tile'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { PAY_STATE_LABEL, payState, useProjectPayouts } from '@/features/team-payouts/pay'
import { PayDialog } from '@/features/team-payouts/PayDialog'

const day = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null

/** "₹12,000 still to pay 3 people · ₹8,000 paid", or that everyone is paid. */
export function payoutsSentence(rows: readonly Pick<ProjectPayoutRow, 'user_id' | 'amount' | 'paid'>[]): string {
  if (rows.length === 0) return 'Nobody is booked on this project yet.'
  const due = rows.reduce((a, r) => a + Math.max(0, r.amount - r.paid), 0)
  const paid = rows.reduce((a, r) => a + r.paid, 0)
  const owed = new Set(rows.filter((r) => r.amount - r.paid > 0.001).map((r) => r.user_id)).size
  const unset = rows.filter((r) => r.amount <= 0 && r.paid <= 0).length
  const parts = [
    due > 0 ? `${formatINR(due)} still to pay ${owed} ${owed === 1 ? 'person' : 'people'}` : 'Everyone with a payout is paid',
    paid > 0 ? `${formatINR(paid)} paid` : null,
    unset > 0 ? `${unset} ${unset === 1 ? 'booking has' : 'bookings have'} no payout set` : null,
  ]
  return parts.filter(Boolean).join(' · ') + '.'
}

/**
 * The project's payouts: each person booked on it, what they are owed, what
 * has gone out, and Pay. "Cards in" marks whose data has been copied --
 * the moment most studios settle a freelancer.
 */
export function PayoutsTab({ projectId }: { projectId: string }) {
  const q = useProjectPayouts(projectId)
  const [paying, setPaying] = useState<ProjectPayoutRow | null>(null)

  if (q.isLoading) return <SkeletonList rows={4} columns={4} />
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />
  const rows = q.data

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{payoutsSentence(rows)}</p>
        <Link to="/team-payouts" className="text-sm font-medium text-primary hover:underline">
          All payouts →
        </Link>
      </div>
      {rows.length > 0 && (
        <Card>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {rows.map((r) => {
              const state = payState(r.amount, r.paid)
              const owed = Math.max(0, r.amount - r.paid)
              return (
                <div key={r.slot_id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', state === 'paid' && 'bg-success/[0.06]')}>
                  <RoleTile name={r.role} size="sm" />
                  <div className="min-w-[10rem] flex-1">
                    <p className="text-sm font-medium">
                      {r.user_name ?? 'Someone'}
                      {r.engagement_type === 'freelancer' && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Freelancer</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[r.role, r.shoot_name, day(r.shoot_date)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {r.data_in && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                      <HardDrive className="size-3" aria-hidden /> Cards in
                    </span>
                  )}
                  <div className="min-w-[7rem] text-right">
                    <p className="text-sm font-semibold tabular-nums">{r.amount > 0 ? formatINR(r.amount) : '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {state === 'part' ? `${formatINR(r.paid)} paid` : r.cost_status !== 'final' && r.amount > 0 ? 'not final' : ' '}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium',
                      state === 'paid' && 'bg-success/15 text-success',
                      (state === 'due' || state === 'part') && 'bg-warning/15 text-warning',
                      state === 'no_amount' && 'bg-muted text-muted-foreground',
                    )}
                  >
                    {PAY_STATE_LABEL[state]}
                    {state === 'paid' && r.last_paid_date ? ` · ${day(r.last_paid_date)}` : ''}
                  </span>
                  {state !== 'paid' ? (
                    <Button size="sm" className={cn(r.data_in && owed > 0 && 'ipc-nudge')} onClick={() => setPaying(r)}>
                      {owed > 0 ? `Pay ${formatINR(owed)}` : 'Set payout'}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setPaying(r)}>
                      Edit
                    </Button>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
      {paying && (
        <PayDialog
          slotId={paying.slot_id}
          userId={paying.user_id}
          name={paying.user_name ?? 'them'}
          amount={paying.amount}
          paid={paying.paid}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  )
}
