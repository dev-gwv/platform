import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { paymentReminderQuote, paymentReminderResult, type InvoiceDetail, type PaymentReminderQuote } from '@ipc/contracts'
import { emailQuote, formatPaise } from '@ipc/domain'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'

const day = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export function usePaymentReminderQuote(invoiceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['billing', 'invoice', invoiceId, 'remind'],
    queryFn: () => callApi(`/billing/invoices/${invoiceId}/remind`, { responseSchema: paymentReminderQuote }),
    enabled: enabled && !!invoiceId,
    staleTime: 30_000,
  })
}

export function useSendPaymentReminder(invoiceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => callApi(`/billing/invoices/${invoiceId}/remind`, { method: 'POST', body: {}, responseSchema: paymentReminderResult }),
    onSuccess: (r) => {
      if (r.status === 'no_email') toast.error(r.error ?? "Add the client's email first.")
      else if (r.repeated) toast.info('A reminder already went a few minutes ago.')
      else if (r.status === 'queued') toast.success('Reminder sent. It reaches the client within a few minutes.')
      else if (r.status === 'skipped_no_balance') toast.error('Not sent: recharge your messaging wallet to send.')
      else if (r.status === 'skipped_limit') toast.error('Not sent: your monthly email limit is reached.')
      else toast.error(r.error ?? 'The reminder could not be sent.')
      void qc.invalidateQueries({ queryKey: ['billing', 'invoice', invoiceId, 'remind'] })
      void qc.invalidateQueries({ queryKey: ['messaging'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** "Free (87 of 100 left this month)", "₹0.20 from your wallet", or why it cannot go. */
export function reminderCostLine(q: PaymentReminderQuote): { text: string; blocked: boolean } {
  if (!q.client_email) return { text: "Add the client's email to send reminders.", blocked: true }
  const e = emailQuote({
    monthEmails: q.month_emails,
    cap: q.email_monthly_cap,
    freeUsed: q.free_used,
    freeMonthly: q.free_monthly,
    pricePaise: q.price_paise,
    canAfford: q.can_afford,
  })
  if (e.kind === 'limit') return { text: 'Monthly email limit reached.', blocked: true }
  if (e.kind === 'free') return { text: `Free (${e.freeLeft} of ${q.free_monthly} left this month)`, blocked: false }
  if (e.kind === 'no_balance') return { text: `Costs ${formatPaise(e.cost)}. Recharge to send.`, blocked: true }
  return { text: e.cost ? `Costs ${formatPaise(e.cost)} from your messaging wallet` : 'Free', blocked: false }
}

/**
 * An emailed payment reminder to the client, by hand, from the invoice. Shows
 * when the last one went (by hand or automatic), and what one costs now.
 */
export function PaymentReminderCard({ invoice, canSend }: { invoice: InvoiceDetail; canSend: boolean }) {
  const due = invoice.balance_due > 0 && (invoice.status === 'sent' || invoice.status === 'partial')
  const q = usePaymentReminderQuote(invoice.id, due)
  const send = useSendPaymentReminder(invoice.id)
  if (!due || !q.data) return null
  const cost = reminderCostLine(q.data)
  // One quiet line above the sheet, not a card of its own: it was the third
  // "remind" on this page and took a block of the screen to say so.
  return (
    <div className="paper-toolbar mx-auto mb-4 flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Reminder email</span>
        {' · '}
        {q.data.last_sent_at ? `last sent ${day(q.data.last_sent_at)}` : 'none sent yet'}
        {q.data.auto_on ? ' · automatic reminders are on' : ''}
        {canSend && <span className="block text-xs sm:inline"> · {cost.text}</span>}
      </p>
      {canSend && (
        <Button size="sm" variant="outline" disabled={cost.blocked || send.isPending} onClick={() => send.mutate()}>
          <BellRing /> Send reminder email
        </Button>
      )}
    </div>
  )
}
