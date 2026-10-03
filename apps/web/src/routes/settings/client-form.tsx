import { useMemo, useState } from 'react'
import { Copy, Download, ExternalLink, MessageCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { buildWhatsAppUrl } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { downloadQrPng, qrSvg } from '@/shared/ui/qr-download'
import { useNewStudioDetailsForm, useStudioDetailsForm } from '@/features/wishes/api'

export function ClientFormPage() {
  return (
    <AuthedPage module="clients">
      <ClientForm />
    </AuthedPage>
  )
}

/**
 * The studio's own details form (0244): one link and QR for the desk or for
 * anyone who has booked. Each form sent in makes a client and their project,
 * with the shoot days and the birthdays and anniversary for Wishes.
 */
function ClientForm() {
  const { session } = useAuth()
  const form = useStudioDetailsForm()
  const fresh = useNewStudioDetailsForm()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const url = form.data?.url ?? ''
  const svg = useMemo(() => (url ? qrSvg(url) : ''), [url])
  const studio = session?.studios.find((m) => m.company_id === session.company_id)?.company_name ?? ''
  const message = `Hi! Please fill in your details and your event dates for ${studio || 'us'} here: ${url}`

  const copy = (text: string, what: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error('Could not copy — select it by hand'),
    )

  return (
    <>
      <PageHeader title="Client details form" />
      {form.isError ? (
        <ErrorState onRetry={() => void form.refetch()} />
      ) : !url ? (
        <Skeleton className="h-56" />
      ) : (
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col items-center gap-4 p-4 sm:flex-row sm:items-start">
            <span
              role="img"
              aria-label="QR code for the client details form"
              className="block size-44 shrink-0 rounded-lg border border-border bg-white p-2"
              // The generator's own SVG of our link, not user input.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <div className="flex w-full min-w-0 flex-col gap-2">
              <p className="text-sm">A client scans it, fills their details and dates, and their project is made with its days.</p>
              <Input readOnly value={url} aria-label="Client details form link" onFocus={(e) => e.currentTarget.select()} className="text-xs" />
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await downloadQrPng(url, 'client-details-form', studio || 'Your details', 'Scan to fill in your details')
                    toast.success('QR downloaded, ready to print')
                  } catch {
                    toast.error('Could not download the QR. Please try again.')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Download /> Download for print
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="flex-1" asChild>
                  <a href={buildWhatsAppUrl(null, message)} target="_blank" rel="noreferrer">
                    <MessageCircle /> WhatsApp
                  </a>
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => copy(url, 'Link')}>
                  <Copy /> Copy link
                </Button>
                <Button variant="outline" className="flex-1" asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open
                  </a>
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="self-start text-muted-foreground"
                disabled={fresh.isPending}
                onClick={async () => {
                  const yes = await confirm({
                    title: 'Make a new link?',
                    description: 'The old link and every printed QR stop working.',
                    confirmLabel: 'Make a new link',
                    destructive: true,
                  })
                  if (yes) fresh.mutate(undefined, { onSuccess: () => toast.success('New link ready'), onError: (e) => toast.error(e.message) })
                }}
              >
                <RefreshCw className="size-4" /> New link
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
