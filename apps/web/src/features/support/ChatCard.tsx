import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, MessageCircle, Send } from 'lucide-react'
import type { SupportTicket, SupportTicketMessage } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { callWhen, chatWindowOpen, useChatReply, useTicketMessages, waLink } from './tickets'

/**
 * A WhatsApp ticket's conversation (0304): what the studio wrote, what the
 * assistant answered, and the owner's reply from the official number.
 */
export function ChatCard({ t }: { t: SupportTicket }) {
  const q = useTicketMessages(t.id, true)
  const reply = useChatReply(t.id)
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const rows = q.data ?? []
  const open = chatWindowOpen(t.last_in_at)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [rows.length])

  const send = () => {
    const words = text.trim()
    if (!words) return
    reply.mutate(words, { onSuccess: () => setText('') })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <MessageCircle className="size-4 text-success" /> WhatsApp conversation
          </h2>
          {t.escalate_why && t.status === 'waiting_us' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
              <AlertTriangle className="size-3" /> Needs you: {t.escalate_why}
            </span>
          )}
        </div>

        <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto rounded-lg border bg-muted/30 p-3">
          {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!q.isLoading && !rows.length && <p className="text-sm text-muted-foreground">No messages yet.</p>}
          {rows.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
          <div ref={end} />
        </div>

        <div className="flex flex-col gap-2">
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your reply…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {t.official_ready ? (
              <Button onClick={send} disabled={!text.trim() || reply.isPending}>
                <Send /> {reply.isPending ? 'Sending…' : 'Send on WhatsApp'}
              </Button>
            ) : (
              <Button asChild disabled={!text.trim()}>
                <a href={waLink(t.contact_phone, text)} target="_blank" rel="noreferrer">
                  <Send /> Open in your WhatsApp
                </a>
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {!t.official_ready
                ? 'The official number is not switched on, so this opens your own WhatsApp.'
                : open
                  ? 'They wrote in the last 24 hours, so your words go as they are.'
                  : 'More than 24 hours since they wrote: WhatsApp only allows the follow-up template, with your words inside it.'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const WHO: Record<SupportTicketMessage['author'], string> = { studio: 'Studio', ai: 'Assistant', owner: 'You', system: 'Auto reply' }

function Bubble({ m }: { m: SupportTicketMessage }) {
  const mine = m.dir === 'out'
  return (
    <div className={cn('flex flex-col gap-0.5', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm',
          mine ? (m.author === 'owner' ? 'bg-success/15' : 'bg-violet-500/10') : 'border bg-card',
          m.status === 'failed' && 'border border-destructive/50',
        )}
      >
        {m.body}
      </div>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {m.author === 'ai' && <Bot className="size-3" />}
        {WHO[m.author]} · {callWhen(m.created_at)}
        {m.status === 'failed' && <span className="text-destructive"> · not sent{m.error ? `: ${m.error.slice(0, 80)}` : ''}</span>}
      </span>
    </div>
  )
}
