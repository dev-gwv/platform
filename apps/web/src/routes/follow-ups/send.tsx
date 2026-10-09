import { Link } from '@tanstack/react-router'
import { Mail, MessageCircle } from 'lucide-react'
import type { SequenceSend } from '@ipc/contracts'
import { waLink } from '@ipc/domain'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useMarkSent, useSendNow, useSkipSend } from '@/features/crm-sequences/api'

export function SendNowPage() {
  return (
    <AuthedPage module="crm">
      <SendNow />
    </AuthedPage>
  )
}

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * Send now: what the sequences wrote today, waiting for a tap. The tap opens
 * WhatsApp (or the mail app) on this phone with the message already typed,
 * from the studio's own number, and marks it sent. The system writes; a
 * person sends.
 */
function SendNow() {
  const q = useSendNow()
  const items = q.data?.items ?? []
  return (
    <>
      <PageHeader
        title="Send now"
        description={
          items.length
            ? `${items.length} message${items.length === 1 ? '' : 's'} ready. Tap to open it with the words typed in.`
            : undefined
        }
      />
      {q.isPending ? (
        <SkeletonList rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to send"
            description="When a sequence writes a message, it waits here for you."
            action={
              <Button variant="outline" asChild>
                <Link to="/follow-ups/setup" search={{ section: 'sequences' } as never}>
                  Your sequences
                </Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((m) => (
            <MessageCard key={m.id} m={m} />
          ))}
        </ul>
      )}
    </>
  )
}

function MessageCard({ m }: { m: SequenceSend }) {
  const sent = useMarkSent()
  const skip = useSkipSend()
  const busy = sent.isPending || skip.isPending
  const href =
    m.channel === 'whatsapp'
      ? m.phone
        ? waLink(m.phone, m.text)
        : null
      : m.email
        ? `mailto:${m.email}?subject=${encodeURIComponent(m.subject ?? '')}&body=${encodeURIComponent(m.text)}`
        : null
  const Icon = m.channel === 'whatsapp' ? MessageCircle : Mail

  return (
    <li>
      <Card className="p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <Link to="/follow-ups" search={{ lead: m.lead_id } as never} className="font-medium hover:underline">
            {m.lead_name || m.phone || m.email || 'Lead'}
          </Link>
          <span className="text-xs text-muted-foreground">
            {m.sequence_name} · step {m.step_no} · {when.format(new Date(m.due_at))}
          </span>
        </div>
        {m.subject && <p className="mt-2 text-sm font-medium">{m.subject}</p>}
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-2.5 text-sm">{m.text}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {href ? (
            <Button asChild disabled={busy}>
              <a href={href} target="_blank" rel="noreferrer" onClick={() => sent.mutate(m.id)}>
                <Icon /> {m.channel === 'whatsapp' ? 'Send on WhatsApp' : 'Send email'}
              </a>
            </Button>
          ) : (
            <Button disabled>
              <Icon /> No {m.channel === 'whatsapp' ? 'phone number' : 'email address'}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => skip.mutate(m.id)}>
            Skip
          </Button>
        </div>
      </Card>
    </li>
  )
}
