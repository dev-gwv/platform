import { useEffect, useState } from 'react'
import { publicInvoice, type PublicInvoice } from '@ipc/contracts'
import { Printer } from 'lucide-react'
import { callApi } from '@/shared/api/client'
import { config } from '@/shared/config'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { Skeleton } from '@/shared/ui/skeleton'
import { formatINR } from '@/shared/ui/format'
import { InvoicePaper } from '@/features/billing/InvoicePaper'

/**
 * PUBLIC page -- no login. The invoice a studio sent, opened from its link:
 * the same sheet the studio sees, with how much is still due and how to pay.
 * The link can be stopped by the studio, and a cancelled invoice stops opening.
 */
export function PublicInvoicePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [doc, setDoc] = useState<PublicInvoice | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('This link is missing its token.')
      return
    }
    callApi(`/public/invoice/${encodeURIComponent(token)}`, { responseSchema: publicInvoice })
      .then(setDoc)
      .catch((e) => setError(e instanceof Error ? e.message : 'This link is invalid or has expired.'))
  }, [token])

  if (error) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-4">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="font-semibold">This invoice link does not open</p>
            <p className="mt-1 text-sm text-muted-foreground">{error} Please ask the studio for a new link.</p>
          </CardContent>
        </Card>
      </div>
    )
  }
  if (!doc) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const inv = doc.invoice
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <div className="paper-toolbar flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {inv.balance_due > 0 ? (
            <>
              <span className="text-muted-foreground">Amount due </span>
              <span className="text-lg font-semibold tabular-nums">{formatINR(inv.balance_due)}</span>
            </>
          ) : (
            <span className="font-semibold text-tone-green">Paid in full. Thank you!</span>
          )}
        </p>
        <div className="flex gap-2">
          <DownloadDocumentButton name={`Invoice ${inv.invoice_number}`} label="Download PDF" />
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>
      <InvoicePaper
        invoice={inv}
        company={doc.company}
        attachmentHref={(id) => `${config.apiBaseUrl}/public/invoice/${encodeURIComponent(token)}/files/${id}`}
      />
      {doc.company.document_footer_note && (
        <p className="paper-toolbar text-center text-xs text-muted-foreground">{doc.company.document_footer_note}</p>
      )}
    </div>
  )
}
