import { useEffect, useState } from 'react'
import { publicReceipt, buildMailtoUrl, buildWhatsAppUrl, type PublicReceipt } from '@ipc/contracts'
import { Printer, Mail, MessageCircle, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { Card, CardContent } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { ReceiptPaper } from '@/features/billing/ReceiptPaper'
import { shortDate } from '@/features/billing/status'
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

  const url = typeof window !== 'undefined' ? window.location.href : ''

  function shareText(): string {
    if (!receipt) return url
    return `Hi ${receipt.client_name ?? 'there'}, we received your payment of ${formatINR(receipt.amount)}${receipt.project_name ? ` for ${receipt.project_name}` : ''} on ${shortDate(receipt.paid_on)}. View/download your receipt: ${url}`
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
    <div className="min-h-screen bg-muted/40 px-3 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {error ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : !receipt ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-6">
              <Skeleton className="h-10 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="paper-toolbar no-print flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-card p-3">
              <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                <Copy /> Copy link
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={buildMailtoUrl(null, `Payment receipt — ${formatINR(receipt.amount)}`, shareText())}>
                  <Mail /> Email
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                <a href={buildWhatsAppUrl(null, shareText())} target="_blank" rel="noreferrer noopener">
                  <MessageCircle /> WhatsApp
                </a>
              </Button>
              <DownloadDocumentButton
                name={`Receipt ${receipt.receipt_number ?? ''}${receipt.client_name ? ` ${receipt.client_name}` : ''}`.trim()}
                label="Download PDF"
                size="sm"
              />
              <Button size="sm" onClick={() => window.print()}>
                <Printer /> Print
              </Button>
            </div>
            <ReceiptPaper receipt={receipt} />
          </>
        )}
      </div>
    </div>
  )
}
