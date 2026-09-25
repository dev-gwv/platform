import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CalendarClock, IndianRupee, MessageCircle } from 'lucide-react'
import type { BillingDueInvoice } from '@ipc/contracts'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useBillingOverview } from './api'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { dueText, isOverdue, shortDate } from './status'
import { whatsappInvoice } from './share'
import { InvoiceBadge } from './InvoiceBadge'

const SHOW = 5

/**
 * The invoices still waiting to be paid, each with a one-tap reminder, at the
 * top of the Invoices page. Nothing shows when nothing is owed, so a studio
 * that is fully paid up sees its list and not an empty box.
 */
export function BillingStrip() {
  const { data } = useBillingOverview()
  const access = useAccess()
  const canRecord = access.hasAction('billing', 'edit')
  const [recording, setRecording] = useState<BillingDueInvoice | null>(null)
  const [all, setAll] = useState(false)
  if (!data) return null
  const rows = all ? data.due_invoices : data.due_invoices.slice(0, SHOW)
  return (
    <div className="mb-5 flex flex-col gap-3">
      {data.due_invoices.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <CalendarClock className="size-4 text-tone-amber" aria-hidden /> Waiting to be paid
                <span className="text-xs font-normal text-muted-foreground">{data.due_invoices.length}</span>
              </h2>
              {data.due_invoices.length > SHOW && (
                <button type="button" onClick={() => setAll((v) => !v)} className="text-xs font-medium text-primary hover:underline">
                  {all ? 'Show fewer' : `Show all ${data.due_invoices.length}`}
                </button>
              )}
            </div>
            <ul className="flex flex-col divide-y divide-border">
              {rows.map((inv) => {
                const late = isOverdue(inv)
                return (
                  <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                    <div className="min-w-[11rem] flex-1">
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
                    <InvoiceBadge invoice={inv} />
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => void whatsappInvoice(inv, true)} title="Send a WhatsApp reminder with the invoice link">
                        <MessageCircle /> Remind
                      </Button>
                      {canRecord && (
                        <Button size="sm" variant="ghost" onClick={() => setRecording(inv)}>
                          <IndianRupee /> Record
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
          {recording && (
            <RecordPaymentDialog
              target={{ kind: 'invoice', invoiceId: recording.id, invoiceNumber: recording.invoice_number }}
              suggested={recording.balance_due}
              onClose={() => setRecording(null)}
            />
          )}
        </Card>
      )}
    </div>
  )
}
