import { useEffect, useState } from 'react'
import { Copy, ExternalLink, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { buildWhatsAppUrl } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { useIssueDetailsLink } from './api'

/** What goes with the link on WhatsApp. */
function detailsMessage(clientName: string | null, studio: string | null, projectName: string, url: string): string {
  const first = clientName?.trim().split(/\s+/)[0]
  return `Hi ${first || 'there'}, ${studio ? `${studio} here. ` : ''}Please fill in your details and dates for ${projectName}: ${url}`
}

/**
 * Send details form (0244): a link the client opens to fill their own name,
 * phone, birthdays, wedding day and events. Opening this makes a new link;
 * the old one stops working. WhatsApp opens on the studio's own phone, free.
 */
export function DetailsLinkDialog({
  projectId,
  projectName,
  clientName,
  clientPhone,
  studioName,
  onClose,
}: {
  projectId: string
  projectName: string
  clientName: string | null
  clientPhone: string | null
  studioName?: string | null
  onClose: () => void
}) {
  const issue = useIssueDetailsLink(projectId)
  const mint = issue.mutateAsync
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Each opening makes a fresh link. If React mounts twice (dev), the second
  // link is the live one and the only one shown.
  useEffect(() => {
    let live = true
    mint()
      .then((d) => live && setUrl(d.url))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [mint])
  const words = url ? detailsMessage(clientName, studioName ?? null, projectName, url) : ''

  function copy(text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error('Could not copy — select it by hand'))
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg" title="Send details form">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {clientName ?? 'The client'} fills their phone, address, birthdays, wedding day and events. The project fills itself in.
          </p>
          {failed ? (
            <p className="text-sm text-destructive">We could not make the link. Please try again.</p>
          ) : !url ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <Input readOnly value={url} aria-label="Details form link" onFocus={(e) => e.currentTarget.select()} className="text-xs" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="bg-success text-white hover:bg-success/90" asChild>
                  <a href={buildWhatsAppUrl(clientPhone, words)} target="_blank" rel="noreferrer noopener">
                    <MessageCircle /> Send on WhatsApp
                  </a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => copy(words)}>
                  <Copy /> Copy message
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={url} target="_blank" rel="noreferrer noopener">
                    <ExternalLink /> Open
                  </a>
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
