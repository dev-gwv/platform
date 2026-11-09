import { toast } from 'sonner'
import { Copy, ExternalLink, Eye, Link2, Loader2, MessageCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { useConfirm } from '@/shared/ui/confirm'
import { designLinkUrl, useDesignLink, useMakeDesignLink, useStopDesignLink } from './api'

const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
})

/** "Opened 3 times · last 2 Nov, 6:40 pm", or that they have not opened it yet. */
export function openedLine(views: number, last: string | null): string {
  if (views === 0 || !last) return 'Not opened yet'
  return `Opened ${views === 1 ? 'once' : `${views} times`} · last ${when.format(new Date(last))}`
}

/** The WhatsApp words that go with the link. */
export function sendText(url: string, client: string, studio: string, title: string): string {
  const hi = client.trim() ? `Hi ${client.trim()},` : 'Hi,'
  return `${hi} here is your quotation${studio ? ` from ${studio}` : ''}: ${title}\n${url}`
}

/**
 * Send to client (0296): one live link to the design, copied or sent on
 * WhatsApp, with when the client opened it. Stop sharing ends the link at
 * once; sharing again makes a new one.
 */
export function SendDesignDialog({
  id,
  title,
  client,
  studio,
  onClose,
}: {
  id: string
  title: string
  client: string
  studio: string
  onClose: () => void
}) {
  const link = useDesignLink(id)
  const make = useMakeDesignLink(id)
  const stop = useStopDesignLink(id)
  const confirm = useConfirm()
  const token = link.data?.token ?? null
  const url = token ? designLinkUrl(token) : ''

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Send to client"
        description={
          client
            ? `A link ${client} can open on their phone, with Download PDF.`
            : 'A link your client can open on their phone, with Download PDF.'
        }
      >
        {link.isPending ? (
          <div className="flex justify-center p-6">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : !token ? (
          <Button
            size="lg"
            className="ipc-nudge w-full"
            onClick={() => make.mutate()}
            disabled={make.isPending}
          >
            {make.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} Make the link
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Link for the client"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button
                className="bg-[#25D366] text-white hover:bg-[#1fb757]"
                onClick={() =>
                  window.open(
                    `https://wa.me/?text=${encodeURIComponent(sendText(url, client, studio, title))}`,
                    '_blank',
                  )
                }
              >
                <MessageCircle /> WhatsApp
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(url).then(
                    () => toast.success('Link copied'),
                    () => toast.error('Could not copy. Select the link and copy it.'),
                  )
                }}
              >
                <Copy /> Copy link
              </Button>
              <Button variant="outline" onClick={() => window.open(url, '_blank')}>
                <ExternalLink /> Open
              </Button>
            </div>
            <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <Eye className="size-4 text-muted-foreground" aria-hidden />
              {openedLine(link.data?.views ?? 0, link.data?.last_viewed_at ?? null)}
            </p>
            <p className="text-xs text-muted-foreground">
              Changes you make show on the link straight away.
            </p>
          </div>
        )}
        <DialogFooter>
          {token && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={async () => {
                if (
                  await confirm({
                    title: 'Stop sharing this design?',
                    description: 'The link stops working at once. Sharing again makes a new link.',
                    destructive: true,
                    confirmLabel: 'Stop sharing',
                  })
                )
                  stop.mutate(undefined, {
                    onSuccess: () => toast.success('The link has stopped.'),
                  })
              }}
            >
              Stop sharing
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
