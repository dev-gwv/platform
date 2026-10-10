import { useState } from 'react'
import { Check, Copy, Eye, FileText, Mail, MessageCircle, Pencil, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { CrmQuote, QuoteStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { StatusBadge } from '@/shared/ui/status-badge'
import { humanize } from '@/shared/ui/format'
import { useINR } from '@/shared/money/MoneyMask'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useDeleteQuote, useSendQuote, useSetQuoteOutcome } from '../api'
import { QuoteViewer } from '../QuoteViewer'

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

const QUOTE_TONE: Record<QuoteStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  declined: 'danger',
  expired: 'warning',
}

/** One quote with its actions; used by the tab and by the drawer's quote panel. */
export function QuoteRow({
  quote: q,
  onOpen,
  onEdit,
  compact = false,
}: {
  quote: CrmQuote
  onOpen?: () => void
  onEdit?: (() => void) | undefined
  compact?: boolean
}) {
  const inr = useINR()
  const [viewing, setViewing] = useState<CrmQuote | null>(null)
  const send = useSendQuote()
  const outcome = useSetQuoteOutcome()
  const del = useDeleteQuote()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const canDelete = access.hasAction('crm', 'delete')

  function deliver(channel: 'none' | 'whatsapp' | 'email') {
    send.mutate(
      { id: q.id, channel },
      {
        onSuccess: (r) => {
          if (r.delivery === 'api') toast.success('Sent on WhatsApp')
          else if (r.open_url) {
            const w = window.open(r.open_url, '_blank', 'noopener')
            if (!w) toast.message('Pop-up blocked — copy the link instead.')
          }
          void navigator.clipboard.writeText(r.url).then(() => toast.message('Quote link copied'))
        },
      },
    )
  }

  async function remove() {
    if (await confirm({ title: `Delete draft ${q.quote_number}?`, confirmLabel: 'Delete', destructive: true })) del.mutate(q.id)
  }

  async function decline() {
    const yes = await confirm({
      title: `Mark ${q.quote_number} declined?`,
      description: 'The client can no longer accept it through their link.',
      confirmLabel: 'Mark declined',
      destructive: true,
    })
    if (yes) outcome.mutate({ id: q.id, status: 'declined' })
  }

  async function reopen() {
    const yes = await confirm({
      title: `Reopen ${q.quote_number}?`,
      description: 'It goes back to awaiting an answer, and the recorded acceptance is cleared.',
      confirmLabel: 'Reopen',
    })
    if (yes) outcome.mutate({ id: q.id, status: 'sent' })
  }

  return (
    <>
    <QuoteViewer quote={viewing} onClose={() => setViewing(null)} />
    <li className={`flex flex-wrap items-center gap-3 ${compact ? 'py-1.5 text-xs' : 'p-3 text-sm'}`}>
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {q.quote_number}
          {q.title ? ` · ${q.title}` : ''}
          {!compact && q.lead_name && onOpen ? (
            <>
              {' · '}
              <button type="button" className="font-normal text-muted-foreground hover:underline" onClick={onOpen}>
                {q.lead_name}
              </button>
            </>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {q.items.length} line{q.items.length === 1 ? '' : 's'}
          {q.valid_until ? ` · valid till ${dayFormat.format(new Date(q.valid_until))}` : ''}
          {q.accepted_at
            ? ` · accepted by ${q.accepted_by_name ?? 'client'}${q.accepted_by_email ? ` (${q.accepted_by_email})` : ''}${q.accepted_ip ? ` from ${q.accepted_ip}` : ''} ${dayFormat.format(new Date(q.accepted_at))}`
            : ''}
          {q.declined_at ? ` · declined${q.decline_reason ? `: ${q.decline_reason}` : ''}` : ''}
        </p>
      </div>
      <span className="tabular-nums">{inr(q.total)}</span>
      <StatusBadge tone={QUOTE_TONE[q.status]}>{humanize(q.status)}</StatusBadge>
      {/*
        * Outside the canEdit gate on purpose: reading a quote is not editing
        * one, and this works for a draft that has never been sent.
        */}
      <Button size="sm" variant="ghost" onClick={() => setViewing(q)} title="View this quote">
        <Eye />
        <span className="sr-only">View quote</span>
      </Button>
      {canEdit && (q.status === 'draft' || q.status === 'sent') && (
        <span className="flex gap-1">
          {q.status === 'draft' && onEdit && (
            <Button size="sm" variant="ghost" onClick={onEdit} title="Edit draft">
              <Pencil />
              <span className="sr-only">Edit</span>
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => deliver('none')} title="Get the link">
            {q.status === 'draft' ? <Send /> : <Copy />} {q.status === 'draft' ? 'Send' : 'Link'}
          </Button>
          <Button size="sm" variant="ghost" disabled={send.isPending} onClick={() => deliver('whatsapp')} title="Send on WhatsApp">
            <MessageCircle />
            <span className="sr-only">WhatsApp</span>
          </Button>
          <Button size="sm" variant="ghost" disabled={send.isPending} onClick={() => deliver('email')} title="Send by email">
            <Mail />
            <span className="sr-only">Email</span>
          </Button>
          {q.status === 'draft' && canDelete && (
            <Button size="sm" variant="ghost" onClick={() => void remove()} title="Delete draft">
              <Trash2 />
              <span className="sr-only">Delete</span>
            </Button>
          )}
          {/* Most answers arrive on the phone, not through the link. */}
          {q.status === 'sent' && (
            <>
              <Button size="sm" variant="ghost" disabled={outcome.isPending} onClick={() => outcome.mutate({ id: q.id, status: 'accepted' })} title="They accepted — record it">
                <Check />
                <span className="sr-only">Mark accepted</span>
              </Button>
              <Button size="sm" variant="ghost" disabled={outcome.isPending} onClick={() => void decline()} title="They declined — record it">
                <X />
                <span className="sr-only">Mark declined</span>
              </Button>
            </>
          )}
        </span>
      )}
      {canEdit && (q.status === 'accepted' || q.status === 'declined') && (
        <Button size="sm" variant="ghost" disabled={outcome.isPending} onClick={() => void reopen()} title="Answered by mistake — put it back">
          <RotateCcw />
          <span className="sr-only">Reopen</span>
        </Button>
      )}
    </li>
    </>
  )
}
