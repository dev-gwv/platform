import { useState } from 'react'
import { Check, Copy, Mail, MessageCircle } from 'lucide-react'
import { buildWhatsAppUrl } from '@ipc/contracts'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useEmailTermsLink } from './api'

/**
 * Three ways to get the link to the client, biggest first: WhatsApp (to
 * their number), email (to their address, editable), or copy it. The same
 * panel appears after the first send and after "send again".
 */
export function ShareTermsPanel({
  documentId,
  token,
  url,
  clientName,
  clientPhone,
  clientEmail,
  projectName,
}: {
  documentId: string
  token: string
  url: string
  clientName: string | null | undefined
  clientPhone: string | null | undefined
  clientEmail: string | null | undefined
  projectName: string
}) {
  const [to, setTo] = useState(clientEmail ?? '')
  const [copied, setCopied] = useState(false)
  const [emailed, setEmailed] = useState<string | null>(null)
  const email = useEmailTermsLink()

  const message = `Hello ${clientName ?? ''}, please read the terms for ${projectName} and tap "I agree" at the end: ${url}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy — select the link and copy it by hand')
    }
  }

  function sendEmail() {
    email.mutate(
      { documentId, token, to_email: to.trim() || null },
      {
        onSuccess: (r) => {
          if (r.status === 'sent') {
            setEmailed(to.trim())
            toast.success(`Emailed to ${to.trim()}`)
          } else if (r.status === 'provider_missing') {
            // No email service set up: open their own mail app instead.
            window.location.href = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(`Terms for ${projectName}`)}&body=${encodeURIComponent(message)}`
          } else {
            toast.error(r.error ?? 'The email did not go out. Try WhatsApp or copy the link.')
          }
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Button asChild size="lg" className="bg-[#25D366] text-white hover:bg-[#1ebe57]">
        <a href={buildWhatsAppUrl(clientPhone, message)} target="_blank" rel="noreferrer noopener">
          <MessageCircle /> Send on WhatsApp{clientPhone ? ` to ${clientPhone}` : ''}
        </a>
      </Button>

      <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Mail className="size-4 text-muted-foreground" aria-hidden /> Send by email
        </p>
        <div className="flex gap-2">
          <Input
            type="email"
            aria-label="Client email"
            placeholder="client@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <Button variant="outline" disabled={!to.trim() || email.isPending} onClick={sendEmail}>
            {emailed === to.trim() && emailed ? <Check /> : null}
            {email.isPending ? 'Sending…' : emailed === to.trim() && emailed ? 'Sent' : 'Send'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={url}>
          {url}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
    </div>
  )
}
