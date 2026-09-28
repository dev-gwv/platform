import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Repeat, Square } from 'lucide-react'
import type { SequenceSend } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useLeadSequence, useSequences, useStartSequence, useStopSequence } from './api'
import { CHANNEL } from './SequencesSection'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const ENDED: Record<string, string> = {
  replied: 'stopped: they replied',
  won: 'stopped: lead won',
  lost: 'stopped: lead lost',
  stopped: 'stopped',
}

const STATUS: Record<SequenceSend['status'], string> = {
  sent: 'Sent',
  manual: 'Waiting in Send now',
  queued: 'Sending',
  sending: 'Sending',
  skipped: 'Skipped',
  failed: 'Not sent',
}

/**
 * The sequence this lead is on, what it has sent, and a way to put the lead
 * on one. Replaces the old cadence panel: same table, now with messages.
 */
export function LeadSequencePanel({ lead }: { lead: { id: string; status: string } }) {
  const { data } = useLeadSequence(lead.id)
  const { data: sequences } = useSequences()
  const start = useStartSequence()
  const stop = useStopSequence()
  const [pick, setPick] = useState('')
  const options = (sequences ?? []).filter((s) => s.is_active && s.steps.length > 0)
  const closed = lead.status === 'converted' || lead.status === 'lost'
  const cur = data?.current ?? null
  const running = cur && !cur.completed_at && !cur.stopped_at
  const sends = (data?.sends ?? []).slice(0, 4)

  if (options.length === 0 && !cur) return null

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Repeat className="size-3.5" /> Sequence
      </p>
      {running ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{cur.name}</span>
          <span className="text-muted-foreground">
            step {cur.step_no} of {cur.total_steps}
            {cur.next_at && ` · next ${cur.next_channel ? CHANNEL[cur.next_channel].label.toLowerCase() : ''} ${when.format(new Date(cur.next_at))}`}
          </span>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={stop.isPending} onClick={() => stop.mutate(lead.id)}>
            <Square /> Stop
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {cur && (
            <span className="text-xs text-muted-foreground">
              {cur.name} {cur.completed_at ? 'finished' : (ENDED[cur.stopped_reason ?? 'stopped'] ?? 'stopped')}.
            </span>
          )}
          {!closed && options.length > 0 && (
            <>
              <Select value={pick} onChange={(e) => setPick(e.target.value)} className="w-56" aria-label="Sequence">
                <option value="">Add to a sequence…</option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.steps.length} step{s.steps.length === 1 ? '' : 's'}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={!pick || start.isPending}
                onClick={() => start.mutate({ id: pick, leadIds: [lead.id] }, { onSuccess: () => setPick('') })}
              >
                Start
              </Button>
            </>
          )}
        </div>
      )}
      {sends.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {sends.map((m) => {
            const Icon = CHANNEL[m.channel].icon
            return (
              <li key={m.id} className="flex items-center gap-2 text-xs">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={m.text}>
                  {m.subject || m.text}
                </span>
                {m.status === 'manual' ? (
                  <Link to="/follow-ups/send" className="shrink-0 font-medium text-primary hover:underline">
                    Send now
                  </Link>
                ) : (
                  <span className={cn('shrink-0', m.status === 'sent' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')} title={m.error ?? undefined}>
                    {STATUS[m.status]}
                    {m.sent_at && ` ${when.format(new Date(m.sent_at))}`}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
