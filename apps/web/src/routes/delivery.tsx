import { useEffect, useState } from 'react'
import { publicDelivery, buildMailtoUrl, buildWhatsAppUrl, type PublicDelivery } from '@ipc/contracts'
import { ExternalLink, PackageCheck, MessageCircle, Mail, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'

/**
 * PUBLIC page — no auth. Where the finished work is.
 *
 * Lovable parity: visibility is sent + submitted&&!reviewed (server enforces,
 * not just approved), title/type/label/branding/ready_at header, expiry +
 * revoked states, view counting, and copy/Email/WhatsApp share. The studio's
 * own storage does the hosting; this page is the handover note that points at
 * it. client_deliveries rows are the server-side delivery log.
 */
export function DeliveryPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [delivery, setDelivery] = useState<PublicDelivery | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('This link is missing its token.')
      return
    }
    callApi(`/public/delivery/${token}`, { responseSchema: publicDelivery })
      .then((d) => {
        if (d.revoked) {
          setError('This delivery link has been revoked. Please ask the studio for a fresh one.')
          return
        }
        if (d.expires_at && new Date(d.expires_at).getTime() < Date.now()) {
          setError('This delivery link has expired. Please ask the studio for a fresh one.')
          return
        }
        setDelivery(d)
      })
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : 'This link is invalid, expired, or not ready yet.',
        ),
      )
  }, [token])

  const url = typeof window !== 'undefined' ? window.location.href : ''
  const shareText = delivery
    ? `Hi, your ${delivery.delivery_label ?? delivery.title ?? 'work'}${delivery.project_name ? ` for ${delivery.project_name}` : ''} is ready: ${url}`
    : url

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Delivery link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="paper relative mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-4">
        <div className="flex items-center gap-2">
          {delivery?.logo_url ? (
            <img src={delivery.logo_url} alt={delivery.company_name ?? 'Studio logo'} className="size-9 rounded-lg object-contain" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <PackageCheck className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight">{delivery?.company_name ?? 'Your work'}</p>
            {delivery?.company_legal_name && delivery.company_legal_name !== delivery.company_name && (
              <p className="text-xs text-muted-foreground">{delivery.company_legal_name}</p>
            )}
            <p className="text-sm text-muted-foreground">
              {delivery?.delivery_label ?? delivery?.title ?? delivery?.project_name ?? 'Ready to view'}
            </p>
            {(delivery?.company_phone || delivery?.company_email || delivery?.company_website) && (
              <p className="text-[11px] text-muted-foreground">
                {[delivery.company_phone, delivery.company_email, delivery.company_website]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
          {delivery?.delivery_type && <StatusBadge>{delivery.delivery_type}</StatusBadge>}
        </div>

        <Card>
          <CardContent className="p-4 sm:p-4">
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : !delivery ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {delivery.client_name ? `Hi ${delivery.client_name},` : 'Hello,'}
                </p>
                <p className="mt-1 font-medium">Your photographs and films are ready.</p>
                {(delivery.ready_at || delivery.delivered_at) && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Delivered {new Date((delivery.ready_at ?? delivery.delivered_at) as string).toLocaleDateString('en-IN')}
                  </p>
                )}
                {delivery.notes && (
                  <p className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    {delivery.notes}
                  </p>
                )}
                {delivery.submission_link ? (
                  <Button asChild className="mt-4 w-full">
                    <a href={delivery.submission_link} target="_blank" rel="noreferrer noopener">
                      <ExternalLink /> {delivery.link_label || delivery.delivery_label || 'Open your gallery'}
                    </a>
                  </Button>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    The studio has not attached a link yet. Please check back, or ask them.
                  </p>
                )}
                {(delivery.channel || (delivery.sent_via && delivery.sent_via.length > 0)) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Shared via {[delivery.channel, ...(delivery.sent_via ?? [])].filter(Boolean).join(' · ')}
                  </p>
                )}
                <div className="no-print mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={buildWhatsAppUrl(null, shareText)} target="_blank" rel="noreferrer noopener">
                      <MessageCircle className="mr-1 size-4" /> WhatsApp
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={buildMailtoUrl(null, `Your work is ready`, shareText)}>
                      <Mail className="mr-1 size-4" /> Email
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void copy()}>
                    <Copy className="mr-1 size-4" /> Copy
                  </Button>
                </div>
                {delivery.document_footer_note && (
                  <p className="mt-4 whitespace-pre-line border-t border-border pt-3 text-[11px] text-muted-foreground">
                    {delivery.document_footer_note}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
