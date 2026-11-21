import { useEffect, useState } from 'react'
import { waLinkOrShare } from '@ipc/domain'
import { toast } from 'sonner'
import { Check, Copy, Mail, MessageCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { useDeliverWork, useMarkClientSent } from './api'

/**
 * Send finished work to the client: copy the link, open WhatsApp with a
 * prefilled message, or open the client's mail app. The sending itself still
 * hands off to the apps the studio already uses — but the LINK is minted
 * here, by the API, rather than being the submission's own URL.
 *
 * That distinction is the whole point. This used to share
 * `submission_link`: the raw internal URL an editor pasted, usually a Drive
 * folder. It never expires, cannot be revoked, and leaves no record of what
 * went to whom. A delivery token does all three — `deliver_work_to_client`,
 * the revoke endpoint and `team_work_client_deliveries` have existed since
 * 0010 and nothing had ever called them.
 *
 * If minting fails the dialog falls back to the raw link rather than leaving
 * someone unable to send finished work at all, and says which one they have.
 */
export function SendWorkToClientDialog({
  open,
  onClose,
  submissionId,
  fallbackLink,
  projectName,
  clientName,
  clientEmail,
  clientPhone,
}: {
  open: boolean
  onClose: () => void
  submissionId: string
  fallbackLink: string
  projectName: string | null
  clientName: string | null
  clientEmail: string | null
  clientPhone: string | null
}) {
  const [copied, setCopied] = useState(false)
  const [email, setEmail] = useState(clientEmail ?? '')
  const [phone, setPhone] = useState(clientPhone ?? '')
  const [minted, setMinted] = useState<string | null>(null)
  const deliver = useDeliverWork()
  const markSent = useMarkClientSent()

  // One token per opening of this dialog, so the link is already in hand
  // whichever channel they pick.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    deliver
      .mutateAsync({ id: submissionId, channel: 'link' })
      .then((r) => {
        if (!cancelled) setMinted(r.link)
      })
      .catch(() => {
        // useDeliverWork has already told them why.
      })
    return () => {
      cancelled = true
    }
  }, [open, submissionId])

  const link = minted ?? fallbackLink

  const message = `Hi ${clientName ?? 'there'}, your ${projectName ? `${projectName} ` : ''}work is ready: ${link}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Link copied.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the link manually.')
    }
  }

  /**
   * Marked only when a send surface actually opens — WhatsApp or the mail
   * client. Copying the link is not a send: someone checking the URL would
   * otherwise leave a record saying the client had it.
   */
  function recordSend(channel: string) {
    markSent.mutate({ id: submissionId, channel })
  }

  function whatsapp() {
    window.open(waLinkOrShare(phone, message), '_blank', 'noopener')
    recordSend('whatsapp')
  }

  function sendEmail() {
    if (!email.trim()) {
      toast.error('Add the client email first.')
      return
    }
    const subject = encodeURIComponent(`${projectName ?? 'Your work'} is ready`)
    recordSend('email')
    window.location.href = `mailto:${email.trim()}?subject=${subject}&body=${encodeURIComponent(message)}`
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title="Send to client" description="Share the finished work link on the channel the client answers.">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{deliver.isPending ? 'Preparing the link…' : link}</span>
            <Button size="sm" variant="outline" disabled={deliver.isPending || !link} onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {/* Which link is in their hand changes what they are promising the
              client, so it is worth one line rather than a silent difference. */}
          {!deliver.isPending && (
            <p className="text-xs text-muted-foreground">
              {minted
                ? 'A client link that you can revoke later, and that expires on its own.'
                : 'Could not prepare a client link, so this is the raw submission link — it will not expire and cannot be revoked.'}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Client phone (WhatsApp)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Client email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" type="email" />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={whatsapp}>
            <MessageCircle /> WhatsApp
          </Button>
          <Button variant="outline" onClick={sendEmail}>
            <Mail /> Email
          </Button>
          <Button onClick={() => void copy()}>
            <Copy /> Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
