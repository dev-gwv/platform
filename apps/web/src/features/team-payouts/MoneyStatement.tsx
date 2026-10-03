import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { CrewPayoutRow } from '@ipc/contracts'
import { crewBucketOf, lineBalance } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { useINR } from '@/shared/money/MoneyMask'
import { crewRowLine } from './crew-view'
import { PayDialog } from './PayDialog'
import { useCanPay, useCrewPayouts } from './pay'

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** Past shoots with money left first (oldest first), then upcoming, then the paid ones. */
export function statementOrder(rows: readonly CrewPayoutRow[], today: string): CrewPayoutRow[] {
  const rank = (r: CrewPayoutRow) => {
    const left = lineBalance(r) > 0.001
    if (crewBucketOf(r.shoot_date, today) === 'past') return left ? 0 : 2
    return 1
  }
  return [...rows].sort((a, b) => {
    const ra = rank(a)
    if (ra !== rank(b)) return ra - rank(b)
    // Owed and upcoming: soonest first. Paid: latest first.
    return ra === 2 ? b.shoot_date.localeCompare(a.shoot_date) : a.shoot_date.localeCompare(b.shoot_date)
  })
}

/**
 * One person's shoot money for the studio: what they are owed for shoots
 * already done, what future shoots will pay, what has gone out -- and Pay on
 * each past booking with money left. Team payouts holds the rest.
 */
export function MoneyStatement({ userId, name }: { userId: string; name: string }) {
  const inr = useINR()
  const can = useCanPay()
  const q = useCrewPayouts(can ? userId : null)
  const [paying, setPaying] = useState<CrewPayoutRow | null>(null)
  if (!can || !q.data || q.data.rows.length === 0) return null
  const s = q.data
  const rows = statementOrder(s.rows, s.today).slice(0, 8)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="font-semibold">Shoot money</h2>
          <p className="mt-1 text-sm">
            {s.owed_now > 0 ? (
              <>
                <span className="font-semibold text-warning">{inr(s.owed_now)}</span> owed for shoots already done
              </>
            ) : (
              'Nothing owed for shoots already done'
            )}
            {s.upcoming > 0 && <> · {inr(s.upcoming)} for shoots coming up</>}
            {s.paid > 0 && (
              <>
                {' '}
                · {inr(s.paid)} paid{s.paid_ahead > 0 ? `, ${inr(s.paid_ahead)} of it in advance` : ''}
              </>
            )}
            .
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((r) => {
            const left = lineBalance(r)
            const past = crewBucketOf(r.shoot_date, s.today) === 'past'
            return (
              <li key={r.slot_id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm', r.amount > 0 && left <= 0.001 && 'bg-success/[0.06]')}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{[r.shoot_name, r.project_name].filter(Boolean).join(' · ') || 'A shoot'}</span>
                  <span className="block text-xs text-muted-foreground">{[dayLabel(r.shoot_date), r.role].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={cn('tabular-nums', past && left > 0.001 ? 'font-medium text-warning' : 'text-muted-foreground')}>
                  {crewRowLine(r, s.today)}
                </span>
                {r.stands && r.amount > 0 && left > 0.001 && (
                  <Button size="sm" variant={past ? 'default' : 'outline'} onClick={() => setPaying(r)}>
                    Pay
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
        {s.rows.length > rows.length && (
          <Link to="/team-payouts" search={{ view: 'all' } as never} className="text-sm font-medium text-primary hover:underline">
            See all {s.rows.length} on Team payouts →
          </Link>
        )}
      </CardContent>
      {paying && (
        <PayDialog
          slotId={paying.slot_id}
          userId={paying.user_id}
          name={name}
          amount={paying.amount}
          paid={paying.paid}
          onClose={() => setPaying(null)}
        />
      )}
    </Card>
  )
}
