import { Link } from '@tanstack/react-router'
import { ChevronRight, Ticket } from 'lucide-react'
import { SUPPORT_TICKET_KIND_LABEL, SUPPORT_TICKET_STATUS_LABEL, type SupportTicket } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { callWhen, dueWords, STATUS_TONE, useSupportTickets } from './tickets'

/**
 * The tickets, at the top of Platform -> Support calls (0300): what waits on
 * you first, then calls coming up, then the rest of the last 30 days. One line
 * each; the ticket page holds the rest.
 */
export function TicketsCard() {
  const q = useSupportTickets()
  const rows = q.data ?? []
  const waiting = rows.filter((t) => t.status === 'waiting_us' || t.status === 'open').length
  const coming = rows.filter((t) => t.status === 'booked' && Date.parse(t.starts_at) > Date.now()).length
  const toFill = rows.filter((t) => t.status === 'booked' && Date.parse(t.starts_at) <= Date.now()).length
  const said = [
    waiting ? `${waiting} waiting on you` : null,
    toFill ? `${toFill} call${toFill === 1 ? '' : 's'} to add a note to` : null,
    coming ? `${coming} coming up` : null,
  ].filter(Boolean)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Ticket className="size-4 text-primary" /> Tickets
          </h2>
          <p className="text-sm text-muted-foreground">{q.isLoading ? 'Loading…' : said.length ? said.join(' · ') : 'Nothing waiting. Every call gets a ticket by itself.'}</p>
        </div>
        {rows.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {rows.slice(0, 30).map((t) => (
              <TicketRow key={t.id} t={t} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function TicketRow({ t }: { t: SupportTicket }) {
  const past = Date.parse(t.starts_at) <= Date.now()
  const needsNote = t.status === 'booked' && past
  const due = t.status !== 'solved' ? dueWords(t.due_on) : null
  const line = needsNote ? 'Call done? Add a voice note.' : (t.next_action ?? t.summary ?? (t.status === 'booked' ? (t.brief ? 'Brief ready' : 'Brief comes an hour before') : ''))
  return (
    <li>
      <Link
        to="/platform/support-calls/tickets/$id"
        params={{ id: t.id }}
        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{t.name}</span>
            {t.studio_name && <span className="text-sm text-muted-foreground">· {t.studio_name}</span>}
            <span className="text-xs text-muted-foreground">{callWhen(t.starts_at)}</span>
          </div>
          {line && <p className={cn('truncate text-sm', needsNote ? 'font-medium text-warning' : 'text-muted-foreground')}>{line}</p>}
        </div>
        {due && <span className={cn('shrink-0 text-xs', due.includes('late') ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{due}</span>}
        {t.kind && <StatusBadge tone="neutral" className="hidden shrink-0 sm:inline-flex">{SUPPORT_TICKET_KIND_LABEL[t.kind]}</StatusBadge>}
        <StatusBadge tone={needsNote ? 'warning' : STATUS_TONE[t.status]} className="shrink-0">
          {needsNote ? 'Add a note' : SUPPORT_TICKET_STATUS_LABEL[t.status]}
        </StatusBadge>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}
