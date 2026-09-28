import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CalendarCheck, ChevronDown, FileText, MessageCircle, Phone } from 'lucide-react'
import { CALL_OUTCOMES } from '@ipc/domain'
import type { DayLeadLine, DayReport, DayReportRow } from '@ipc/contracts'
import { Card } from '@/shared/ui/card'
import { IconTile, type Tone } from '@/shared/ui/icon-tile'
import { cn } from '@/shared/ui/cn'
import { useMyDay, useTeamDay } from './api'

const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' })

/**
 * "Today so far" on Today's calls (0205): what this caller has done today,
 * in four numbers that move the moment a call is logged, and the leads they
 * worked. Owners looking at Everyone get one line per caller instead.
 */
export function MyDayStrip({ scope }: { scope: 'mine' | 'all' }) {
  return scope === 'all' ? <TeamDay /> : <MyDay />
}

function Tile({ icon, tone, value, label, sub }: { icon: typeof Phone; tone: Tone; value: number; label: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
      <IconTile icon={icon} tone={value > 0 ? tone : 'muted'} />
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {label}
          {sub && <span> · {sub}</span>}
        </p>
      </div>
    </div>
  )
}

function MyDay() {
  const q = useMyDay()
  const [open, setOpen] = useState(false)
  const d: DayReport | undefined = q.data
  if (!d) return null
  const worked = d.lead_lines.length
  return (
    <Card className="mb-3 overflow-hidden">
      <p className="border-b border-border px-3 pt-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:px-4">Today so far</p>
      <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <Tile icon={Phone} tone="blue" value={d.calls_made} label={d.calls_made === 1 ? 'call' : 'calls'} sub={`${d.calls_answered} answered`} />
        <Tile icon={MessageCircle} tone="green" value={d.messages} label={d.messages === 1 ? 'message' : 'messages'} />
        <Tile icon={FileText} tone="violet" value={d.quotes_sent} label={d.quotes_sent === 1 ? 'quotation sent' : 'quotations sent'} />
        <Tile icon={CalendarCheck} tone="amber" value={d.booked} label="booked" />
      </div>
      {worked > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50 sm:px-4"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            Leads you worked ({worked})
            <ChevronDown className={cn('ml-auto size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <ul className="divide-y divide-border border-t border-border">
              {d.lead_lines.map((l) => (
                <LeadLine key={l.id} line={l} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

const WHAT: Record<string, string> = { call: 'Called', whatsapp: 'WhatsApp', email: 'Emailed', sms: 'SMS', note: 'Note', task: 'Follow-up done', meeting: 'Met' }

function LeadLine({ line: l }: { line: DayLeadLine }) {
  const outcome = l.last_outcome ? CALL_OUTCOMES.find((o) => o.key === l.last_outcome)?.label ?? l.last_outcome : null
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm sm:px-4">
      <Link to="/follow-ups" search={{ lead: l.id } as never} className="font-medium hover:underline">
        {l.name || l.phone || 'No name'}
      </Link>
      <span className="text-xs text-muted-foreground">
        {time.format(new Date(l.last_at))} · {WHAT[l.last_type] ?? l.last_type}
        {outcome && ` · ${outcome}`}
        {l.last_note && ` — ${l.last_note}`}
      </span>
      {l.next_at && <span className="ml-auto text-xs text-muted-foreground">next {new Date(l.next_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
    </li>
  )
}

function TeamDay() {
  const q = useTeamDay(true)
  const rows: DayReportRow[] = q.data?.items ?? []
  if (rows.length === 0) return null
  return (
    <Card className="mb-3 overflow-hidden">
      <p className="border-b border-border px-3 pt-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:px-4">Today so far, by caller</p>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm sm:px-4">
            <span className="min-w-32 font-medium">{r.user_name}</span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{r.calls_made}</strong> {r.calls_made === 1 ? 'call' : 'calls'} · {r.calls_answered} answered
            </span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{r.messages}</strong> {r.messages === 1 ? 'message' : 'messages'}
            </span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{r.quotes_sent}</strong> {r.quotes_sent === 1 ? 'quotation' : 'quotations'}
            </span>
            <span className="text-muted-foreground">
              <strong className="text-foreground">{r.booked}</strong> booked
            </span>
            {r.overdue_left > 0 && <span className="ml-auto rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{r.overdue_left} overdue</span>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
