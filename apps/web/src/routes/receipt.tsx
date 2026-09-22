import { useEffect, useState } from 'react'
import { publicReceipt, buildMailtoUrl, buildWhatsAppUrl, type PublicReceipt } from '@ipc/contracts'
import { IndianRupee, Printer, Mail, MessageCircle, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { Card, CardContent } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR } from '@/shared/ui/format'

/**
 * PUBLIC page — no auth. A payment receipt, sent after money lands.
 *
 * Lovable parity: studio branding/logo, GSTIN, description, payment status,
 * view counting (server-side access_count), and WhatsApp/mailto/copy share.
 * Prints as it looks for the accountant.
 */
export function ReceiptPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('This link is missing its token.')
      return
    }
    callApi(`/public/receipt/${token}`, { responseSchema: publicReceipt })
      .then(setReceipt)
      .catch((e) => setError(e instanceof Error ? e.message : 'This link is invalid or expired.'))
  }, [token])

  const balance = receipt ? Math.max(0, receipt.total_cost - receipt.received_total) : 0
  const url = typeof window !== 'undefined' ? window.location.href : ''

  function shareText(): string {
    if (!receipt) return url
    return `Hi ${receipt.client_name ?? 'there'}, we received your payment of ${formatINR(receipt.amount)}${receipt.project_name ? ` for ${receipt.project_name}` : ''} on ${receipt.paid_on}. View/download your receipt: ${url}`
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Receipt link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  return (
    <div className="paper mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-4">
      <Card>
        <CardContent className="p-4">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !receipt ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  {receipt.logo_url && (
                    <img src={receipt.logo_url} alt={receipt.company_name ?? 'Studio logo'} className="mb-2 h-10 w-auto object-contain" />
                  )}
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Payment received
                  </p>
                  <p className="text-lg font-semibold">{receipt.company_name}</p>
                  {receipt.company_legal_name && receipt.company_legal_name !== receipt.company_name && (
                    <p className="text-xs text-muted-foreground">{receipt.company_legal_name}</p>
                  )}
                  {(receipt.company_phone || receipt.company_email || receipt.company_address) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[receipt.company_phone, receipt.company_email, receipt.company_address].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {receipt.company_website && (
                    <p className="text-xs text-muted-foreground">{receipt.company_website}</p>
                  )}
                  {receipt.gstin && (
                    <p className="text-xs text-muted-foreground">GSTIN: {receipt.gstin}</p>
                  )}
                </div>
                <span className="flex flex-col items-end gap-2 text-right">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                    <IndianRupee className="size-5" />
                  </span>
                  {receipt.status && <StatusBadge tone="success">{receipt.status}</StatusBadge>}
                  {receipt.receipt_number && (
                    <span className="font-mono text-xs text-muted-foreground">{receipt.receipt_number}</span>
                  )}
                  {receipt.is_gst && (
                    <span className="text-[11px] text-muted-foreground">
                      GST{receipt.payment_gst_number ? ` · ${receipt.payment_gst_number}` : ''}
                    </span>
                  )}
                </span>
              </div>

              <p className="mt-4 text-2xl font-semibold tabular-nums">
                {formatINR(receipt.amount)}
              </p>
              <p className="text-sm text-muted-foreground">
                {receipt.paid_on}
                {receipt.mode ? ` · ${receipt.mode}` : ''}
                {receipt.reference ? ` · ${receipt.reference}` : ''}
              </p>
              {receipt.description && (
                <p className="mt-2 text-sm text-muted-foreground">{receipt.description}</p>
              )}
              {receipt.invoice_number && (
                <p className="mt-1 text-xs text-muted-foreground">Invoice {receipt.invoice_number}</p>
              )}

              {receipt.line_items && receipt.line_items.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Rate</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipt.line_items.map((li, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-2">
                            {li.description}
                            {li.subtext && <p className="text-xs text-muted-foreground">{li.subtext}</p>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{li.quantity ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{li.rate != null ? formatINR(li.rate) : '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{li.amount != null ? formatINR(li.amount) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(receipt.client_phone || receipt.client_email || receipt.client_address) && (
                <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Received from
                  </p>
                  <p className="mt-1 font-medium">{receipt.client_name ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    {[receipt.client_phone, receipt.client_email].filter(Boolean).join(' · ')}
                  </p>
                  {receipt.client_address && (
                    <p className="whitespace-pre-line text-xs text-muted-foreground">{receipt.client_address}</p>
                  )}
                </div>
              )}

              <dl className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4 text-sm">
                <Row label="Project" value={receipt.project_name ?? '—'} />
                <Row label="Client" value={receipt.client_name ?? '—'} />
                <Row label="Project total" value={formatINR(receipt.total_cost)} />
                <Row label="Paid so far" value={formatINR(receipt.received_total)} />
                <Row label="Balance" value={formatINR(balance)} strong />
              </dl>

              {receipt.document_footer_note && (
                <p className="mt-4 whitespace-pre-line border-t border-border pt-3 text-[11px] text-muted-foreground">
                  {receipt.document_footer_note}
                </p>
              )}

              <div className="no-print mt-4 flex flex-wrap gap-2">
                <DownloadDocumentButton
                  name={`Receipt ${receipt.receipt_number}${receipt.client_name ? ` ${receipt.client_name}` : ''}`}
                  label="Download PDF"
                  className="flex-1"
                />
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer /> Print
                </Button>
              </div>
              <div className="no-print mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <a href={buildWhatsAppUrl(null, shareText())} target="_blank" rel="noreferrer noopener">
                    <MessageCircle className="mr-1 size-4" /> WhatsApp
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={buildMailtoUrl(null, `Payment receipt — ${formatINR(receipt.amount)}`, shareText())}>
                    <Mail className="mr-1 size-4" /> Email
                  </a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                  <Copy className="mr-1 size-4" /> Copy link
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  )
}
