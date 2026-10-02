import { Link } from '@tanstack/react-router'
import type { DueLineRow } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { daysLeft } from '@/shared/ui/days-left'

const KIND: Record<DueLineRow['kind'], string> = {
  invoice: 'Invoice',
  promise: 'Promised',
  plan: 'Plan',
  rest: 'Not planned yet',
}

/**
 * The lines behind one tile -- Overdue, Due in 30 days or Later -- each with
 * the one thing to do: an invoice opens, a promise is marked received, a plan
 * part or the rest opens the project's Billing.
 */
export function DuePanel({
  title,
  lines,
  today,
  onMarkReceived,
}: {
  title: string
  lines: readonly DueLineRow[]
  today: string
  onMarkReceived: (paymentId: string) => void
}) {
  return (
    <Card className="mb-4">
      <CardContent className="p-0">
        <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">{title}</p>
        {lines.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((l, i) => (
              <li key={`${l.kind}-${l.invoice_id ?? l.payment_id ?? l.project_id}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-[12rem] flex-1">
                  <span className="font-medium">{[l.project_name, l.client_name].filter(Boolean).join(' · ') || l.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {KIND[l.kind]} · {l.label}
                  </span>
                </span>
                <span className={cn('w-28 text-xs', l.bucket === 'overdue' ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                  {daysLeft(l.due_on, today)?.text ?? 'No date yet'}
                </span>
                <span className="w-24 text-right font-semibold tabular-nums">{formatINR(l.amount)}</span>
                <span className="w-36 text-right">
                  {l.kind === 'invoice' && l.invoice_id ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/billing/invoices/$id" params={{ id: l.invoice_id }}>
                        Open invoice
                      </Link>
                    </Button>
                  ) : l.kind === 'promise' && l.payment_id ? (
                    <Button size="sm" onClick={() => onMarkReceived(l.payment_id!)}>
                      Mark received
                    </Button>
                  ) : l.project_id ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/projects/$id" params={{ id: l.project_id }} search={{ tab: 'billing' } as never}>
                        Open billing
                      </Link>
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
