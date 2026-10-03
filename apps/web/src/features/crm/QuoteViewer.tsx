import { Printer } from 'lucide-react'
import type { CrmQuote } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { StatusBadge } from '@/shared/ui/status-badge'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { useStudioLetterhead } from '@/features/projects/letterhead'
import { QuotePaper } from './QuotePaper'

/**
 * Read a quote in the app, the way the client sees it.
 *
 * The quotes list could send a quote four ways — link, WhatsApp, email, mark
 * accepted — and open it none. To check what a number actually covered, the
 * studio had to copy the client's own accept link and open the page with the
 * Accept and Decline buttons on it, which is a genuinely bad place to be
 * clicking around in.
 *
 * Everything here is already in the row: the list endpoint returns each
 * quote's line items with it. So this is a reader, not a fetch — it opens
 * instantly and works for a draft that has never been sent.
 */
export function QuoteViewer({ quote, onClose }: { quote: CrmQuote | null; onClose: () => void }) {
  const { studio, brandColor } = useStudioLetterhead()
  if (!quote) return null

  const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const tone =
    quote.status === 'accepted'
      ? 'success'
      : quote.status === 'declined'
        ? 'danger'
        : quote.status === 'expired'
          ? 'warning'
          : 'neutral'

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        title={`${quote.quote_number}${quote.title ? ` · ${quote.title}` : ''}`}
        description={[quote.lead_name, quote.valid_until ? `Valid till ${dayFormat.format(new Date(quote.valid_until))}` : null]
          .filter(Boolean)
          .join(' · ') || 'Quotation'}
        className="max-w-3xl"
      >
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={tone}>{quote.status}</StatusBadge>
            {quote.sent_at && (
              <span className="text-xs text-muted-foreground">
                Sent {dayFormat.format(new Date(quote.sent_at))}
              </span>
            )}
          </div>

          <QuotePaper
            data={{
              studio,
              brandColor,
              number: quote.quote_number,
              title: quote.title,
              preparedFor: quote.lead_name,
              issuedAt: quote.sent_at ?? quote.created_at,
              validUntil: quote.valid_until,
              items: quote.items,
              subtotal: quote.subtotal,
              discount: quote.discount,
              tax: quote.tax,
              total: quote.total,
              intraState: quote.intra_state,
              notes: quote.notes,
              terms: quote.terms,
            }}
          />

          {/* The client's own answer, which is the evidence for the booking. */}
          {quote.accepted_at && (
            <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
              Accepted by {quote.accepted_by_name ?? 'the client'}
              {quote.accepted_by_email ? ` (${quote.accepted_by_email})` : ''} on{' '}
              {new Date(quote.accepted_at).toLocaleString('en-IN')}
              {quote.accepted_ip ? ` from ${quote.accepted_ip}` : ''}.
            </p>
          )}
          {quote.declined_at && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              Declined on {new Date(quote.declined_at).toLocaleString('en-IN')}
              {quote.decline_reason ? ` — ${quote.decline_reason}` : ''}.
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <DownloadDocumentButton name={`${quote.quote_number}${quote.title ? ` ${quote.title}` : ''}`} />
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1 size-4" /> Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

