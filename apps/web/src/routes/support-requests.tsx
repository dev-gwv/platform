import { useState } from 'react'
import { CheckCircle2, LifeBuoy, Loader2, Paperclip, Send, Users } from 'lucide-react'
import type { SupportRequest } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { openReportProblem } from '@/features/support/ReportProblem'
import { useReplySupportRequest, useResolveSupportRequest, useSupportRequests } from '@/features/support/api'

export function SupportRequestsPage() {
  return (
    <AuthedPage module="dashboard">
      <PageHeader
        title="Your requests"
        actions={
          <Button onClick={() => openReportProblem()}>
            <LifeBuoy /> Tell the team
          </Button>
        }
      />
      <Requests />
    </AuthedPage>
  )
}

const STATUS: Record<SupportRequest['status'], { word: string; tone: string }> = {
  open: { word: 'With the team', tone: 'bg-warning/15 text-warning' },
  waiting: { word: 'With the team', tone: 'bg-warning/15 text-warning' },
  answered: { word: 'Answered', tone: 'bg-success/15 text-success' },
  closed: { word: 'Closed', tone: 'bg-muted text-muted-foreground' },
}
const whenFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
/** A date the server sent, or nothing: an unreadable one must never take the page down (it did once). */
const when = { format: (d: Date) => (Number.isNaN(d.getTime()) ? '' : whenFmt.format(d)) }

/** Support requests (0271): each one with its replies; ?r=<id> opens one. */
function Requests() {
  const q = useSupportRequests()
  const [open, setOpen] = useUrlParam('r')
  if (q.isPending) return <SkeletonList rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const { items } = q.data
  if (!items.length) {
    return (
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col items-start gap-3 p-5">
          <p className="text-sm text-muted-foreground">Nothing yet. When something isn’t working or you have a question, tell the team here and we answer within a working day.</p>
          <Button onClick={() => openReportProblem()}>
            <LifeBuoy /> Tell the team
          </Button>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      {items.map((r) => (
        <RequestCard key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? '' : r.id)} />
      ))}
    </div>
  )
}

function RequestCard({ r, open, onToggle }: { r: SupportRequest; open: boolean; onToggle: () => void }) {
  const last = r.messages[r.messages.length - 1]
  const s = STATUS[r.status]
  return (
    <Card className={cn(r.status === 'answered' && 'border-success/40')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{r.subject}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {r.mine ? '' : `${r.created_by_name ?? 'Someone'} · `}
            {last ? `${last.sender === 'support' ? 'The team replied' : 'You wrote'} ${when.format(new Date(last.created_at))}` : ''}
            {r.urgency === 'high' ? ' · urgent' : ''}
          </span>
        </span>
        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', s.tone)}>{s.word}</span>
      </button>
      {open && <Thread r={r} />}
    </Card>
  )
}

function Thread({ r }: { r: SupportRequest }) {
  const [text, setText] = useState('')
  const reply = useReplySupportRequest(r.id)
  const solved = useResolveSupportRequest(r.id)
  const last = r.messages[r.messages.length - 1]
  return (
    <CardContent className="flex flex-col gap-3 border-t border-border p-4">
      {r.messages.map((m) => (
        <div key={m.id} className={cn('max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-sm', m.sender === 'support' ? 'ml-auto bg-primary/10' : 'bg-muted')}>
          {m.sender === 'support' && (
            <span className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-primary">
              <Users className="size-3" aria-hidden /> {m.author_name || 'Studio AutoPilot team'}
            </span>
          )}
          {m.body}
          {m.files.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-2">
              {m.files.map((f) => (
                <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
                  <Paperclip className="size-3" aria-hidden /> {f.name}
                </a>
              ))}
            </span>
          )}
          <span className="mt-1 block text-[11px] text-muted-foreground">{when.format(new Date(m.created_at))}</span>
        </div>
      ))}
      {r.status !== 'closed' && last?.sender === 'me' && (
        <p className="text-xs text-muted-foreground">With the team: we answer here within a working day, and your bell will ring.</p>
      )}
      <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={r.status === 'closed' ? 'Write again to open it' : 'Add more, or reply'} className="text-sm" />
      <div className="flex flex-wrap justify-end gap-2">
        {r.status === 'answered' && (
          <Button variant="outline" onClick={() => solved.mutate()} disabled={solved.isPending}>
            <CheckCircle2 /> That solved it
          </Button>
        )}
        <Button onClick={() => reply.mutate(text.trim(), { onSuccess: () => setText('') })} disabled={!text.trim() || reply.isPending}>
          {reply.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send
        </Button>
      </div>
    </CardContent>
  )
}
