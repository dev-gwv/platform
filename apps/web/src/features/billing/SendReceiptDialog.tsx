import { useEffect, useMemo, useState } from 'react'
import { Mail, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { formatINR } from '@/shared/ui/format'
import { sendReceiptEmails, type ReceiptShareSummary } from './receiptShare'
import type { ReceivedPayment } from './api'
import { shortDate } from './status'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Multi-recipient receipt email (Lovable SendPaymentReceiptDialog parity).
 * Sends via POST /documents/receipts/send-email; when the provider is
 * missing the helper falls back to mailto (or copies the link).
 */
export function SendReceiptDialog({
  open,
  onOpenChange,
  payment,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  payment: ReceivedPayment | null
}) {
  const [emails, setEmails] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const defaultEmail = (payment?.client_email ?? '').trim().toLowerCase()
  const summary: ReceiptShareSummary = {
    clientName: payment?.client_name ?? null,
    projectName: payment?.project_name ?? null,
    amountFormatted: payment ? formatINR(payment.amount) : '',
    paymentDate: shortDate(payment?.date_received),
  }

  useEffect(() => {
    if (open) {
      setEmails(defaultEmail && EMAIL_RE.test(defaultEmail) ? [defaultEmail] : [])
      setInput('')
      setSending(false)
    }
  }, [open, defaultEmail])

  const canAdd = useMemo(() => {
    const v = input.trim().toLowerCase()
    return EMAIL_RE.test(v) && !emails.includes(v)
  }, [input, emails])

  function addEmail() {
    const v = input.trim().toLowerCase()
    if (!v) return
    if (!EMAIL_RE.test(v)) {
      toast.error('Please enter a valid email address.')
      return
    }
    if (emails.includes(v)) {
      toast.error('This email is already added.')
      return
    }
    setEmails((prev) => [...prev, v])
    setInput('')
  }

  async function onSend() {
    if (!payment) return
    const pending = input.trim().toLowerCase()
    const toSend = [...emails]
    if (pending) {
      if (!EMAIL_RE.test(pending)) {
        toast.error('Please enter a valid email address.')
        return
      }
      if (!toSend.includes(pending)) toSend.push(pending)
    }
    if (toSend.length === 0 && !defaultEmail) {
      toast.error('Add at least one email to send the receipt.')
      return
    }
    setSending(true)
    try {
      const ok = await sendReceiptEmails(payment.id, toSend, {
        clientEmail: defaultEmail || null,
        subject: `Payment Receipt${summary.projectName ? ` for ${summary.projectName}` : ''} - ${summary.amountFormatted}`,
        text: `Hi ${summary.clientName || 'there'}, here is your payment receipt of ${summary.amountFormatted}.`,
      })
      if (ok) onOpenChange(false)
    } finally {
      setSending(false)
    }
  }

  const hasRecipient = emails.length > 0 || EMAIL_RE.test(input.trim().toLowerCase()) || !!defaultEmail

  return (
    <Dialog open={open} onOpenChange={(v) => !sending && onOpenChange(v)}>
      <DialogContent title="Send payment receipt" description="Send this receipt by email. You can add multiple recipients.">
        <div className="flex flex-col gap-3">
          {payment && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-semibold">{payment.client_name || '—'}</span>
                <span className="font-bold tabular-nums">{formatINR(payment.amount)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="truncate">{payment.project_name || 'No project'}</span>
                <span className="shrink-0">{payment.date_received ?? ''}</span>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Recipient emails</p>
            {emails.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {emails.map((e) => (
                  <span key={e} className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 py-1 pl-2.5 pr-1 text-xs">
                    <span className="max-w-[200px] truncate">{e}</span>
                    <button
                      type="button"
                      onClick={() => setEmails((prev) => prev.filter((x) => x !== e))}
                      className="inline-flex size-5 items-center justify-center rounded hover:bg-foreground/10"
                      aria-label={`Remove ${e}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                type="email"
                inputMode="email"
                placeholder="Enter email address"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addEmail()
                  }
                }}
                disabled={sending}
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={addEmail} disabled={!canAdd || sending}>
                <Plus className="mr-1 size-4" /> Add
              </Button>
            </div>
            {emails.length === 0 && !input && (
              <p className="text-xs italic text-muted-foreground">
                {defaultEmail ? 'Will send to the client email on file unless you add recipients.' : 'No recipients added yet.'}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void onSend()} disabled={sending || !hasRecipient || !payment}>
              <Mail className="mr-2 size-4" /> {sending ? 'Sending…' : 'Send Receipt'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
