import { Link } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { formatINR } from '@/shared/ui/format'
import { useCanPay, useCrewOwed } from '@/features/team-payouts/pay'
import { whoYouOweLine } from '@/features/team-payouts/crew-view'

/**
 * What the studio owes its crew for shoots already done, with the three it
 * owes most. The same sum Team payouts opens on (Owed now), so the two never
 * disagree. Money for shoots still to come is not owed yet and is not here.
 */
export function WhoYouOwe() {
  const can = useCanPay()
  const q = useCrewOwed(can)
  if (!can || !q.data) return null
  const o = q.data
  // A studio that has never paid or booked crew money has nothing to say here.
  if (o.owed_now <= 0 && o.paid <= 0 && o.upcoming <= 0) return null
  if (o.owed_now <= 0) {
    return (
      <Card className="border-success/40 bg-success/5">
        <CardContent className="flex items-center gap-2 p-4 text-sm">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          All crew paid for shoots already done.
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
        <CardTitle>Who you owe</CardTitle>
        <Button asChild size="sm">
          <Link to="/team-payouts" search={{ view: 'owed' } as never}>
            Pay <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        <p className="text-sm">{whoYouOweLine(o)}</p>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {o.people.slice(0, 3).map((p) => (
            <li key={p.user_id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="truncate">{p.user_name ?? 'Someone'}</span>
              <span className="shrink-0 tabular-nums">
                {formatINR(p.owed)}
                <span className="ml-1 text-xs text-muted-foreground">
                  · {p.bookings} {p.bookings === 1 ? 'shoot' : 'shoots'}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {o.people.length > 3 && (
          <p className="text-xs text-muted-foreground">and {o.people.length - 3} more</p>
        )}
      </CardContent>
    </Card>
  )
}
