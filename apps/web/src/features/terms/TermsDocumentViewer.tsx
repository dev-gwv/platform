import { Printer, AlertTriangle, Clock } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { ErrorState } from '@/shared/ui/states'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { useTermsDocumentPayload } from './document'
import { TermsDocumentLetterhead, TermsDocumentSheet } from './TermsDocumentSheet'

/**
 * Read a terms document without leaving the app.
 *
 * Until this existed the only way to see what had been sent was to mint a
 * client link and open the client's own acknowledge page — which put an "I
 * agree" box in front of the studio's own staff and counted the visit as the
 * client having read it.
 *
 * Deliberately read-only: no agree box, no token, and the share actions stay
 * on the row behind it. Opening a document and sending one are different
 * decisions and should not sit under the same click.
 */
export function TermsDocumentViewer({
  documentId,
  onClose,
}: {
  documentId: string | null
  onClose: () => void
}) {
  const { data, isLoading, isError, refetch } = useTermsDocumentPayload(documentId)

  const expired = data?.expires_at ? new Date(data.expires_at).getTime() < Date.now() : false

  return (
    <Dialog open={!!documentId} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        title={data?.title ?? 'Document'}
        description={
          data
            ? [data.project_name, data.client_name].filter(Boolean).join(' · ') || 'Terms & conditions'
            : 'Loading the document…'
        }
        className="max-w-3xl"
      >
        {isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <div className="flex flex-col gap-2 p-2" role="status" aria-label="Loading the document">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className={i % 3 === 2 ? 'h-3 w-3/4' : 'h-3 w-full'} />
            ))}
          </div>
        ) : (
          <div className="paper flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
            <TermsDocumentLetterhead doc={data} />

            {/*
              * A revoked or lapsed document still opens — it is usually the one
              * somebody needs to re-read — but it has to say so, or the studio
              * reads it and assumes the client can still see the same thing.
              */}
            {(data.revoked || expired) && (
              <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                {data.revoked ? <AlertTriangle className="size-4 shrink-0" /> : <Clock className="size-4 shrink-0" />}
                <span>
                  {data.revoked
                    ? 'This link has been revoked — the client can no longer open it.'
                    : 'This link has expired — the client can no longer open it.'}{' '}
                  You are reading the studio’s copy.
                </span>
              </div>
            )}

            {data.acknowledged_at && (
              <p className="text-xs text-muted-foreground">
                Agreed by {data.acknowledged_by_name ?? 'the client'} on{' '}
                {new Date(data.acknowledged_at).toLocaleString('en-IN')}
              </p>
            )}

            <TermsDocumentSheet doc={data} bodyClassName="" />

            <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <StatusBadge tone="neutral">
                Opened by the client {data.access_count} {data.access_count === 1 ? 'time' : 'times'}
              </StatusBadge>
              <div className="flex gap-2">
                <DownloadDocumentButton
                  name={`${data.document_number ?? 'Terms'}${data.project_name ? ` ${data.project_name}` : ''}`}
                />
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="mr-1 size-4" /> Print
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
