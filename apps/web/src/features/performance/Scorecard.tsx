import { CalendarCheck, Camera, CheckCircle2, Clock, type LucideIcon } from 'lucide-react'
import type { MemberScorecard } from '@ipc/contracts'
import { IconTile, type Tone } from '@/shared/ui/icon-tile'
import { cn } from '@/shared/ui/cn'

/** Green from 85, amber from 60, rose below. The same bands everywhere. */
function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return 'muted'
  if (score >= 85) return 'green'
  if (score >= 60) return 'amber'
  return 'rose'
}

const BAR: Record<Tone, string> = {
  green: 'bg-tone-green',
  amber: 'bg-tone-amber',
  rose: 'bg-tone-rose',
  blue: 'bg-tone-blue',
  violet: 'bg-tone-violet',
  teal: 'bg-tone-teal',
  muted: 'bg-muted-foreground/30',
}
const TEXT: Record<Tone, string> = {
  green: 'text-tone-green',
  amber: 'text-tone-amber',
  rose: 'text-tone-rose',
  blue: 'text-tone-blue',
  violet: 'text-tone-violet',
  teal: 'text-tone-teal',
  muted: 'text-muted-foreground',
}

/** The score as a big number, or "—" when there is nothing to measure yet. */
export function ScoreNumber({ score, className }: { score: number | null | undefined; className?: string }) {
  return (
    <span className={cn('font-semibold tabular-nums', TEXT[scoreTone(score)], className)}>
      {score == null ? '—' : score}
      {score != null && <span className="text-[0.55em] font-medium text-muted-foreground">/100</span>}
    </span>
  )
}

interface Part {
  icon: LucideIcon
  label: string
  /** The sentence that says what the number means. */
  says: string
  pct: number | null
  weight: number
}

/** The four parts in plain words, the way the score is built. */
function scoreParts(c: MemberScorecard): Part[] {
  const w = c.work
  const q = c.quality
  const s = c.shoots
  const a = c.attendance
  const parts: Part[] = [
    {
      icon: Clock,
      label: 'Work on time',
      says: w.with_due === 0 ? 'Nothing with a due date finished yet.' : `${w.on_time} of ${w.with_due} finished by the due date${w.avg_days_late ? ` · late ones ${w.avg_days_late} days on average` : ''}.`,
      pct: w.pct,
      weight: 40,
    },
    {
      icon: CheckCircle2,
      label: 'Right first time',
      says: q.approved === 0 ? 'No work approved yet.' : q.sent_back === 0 ? `All ${q.approved} approved without changes.` : `${q.approved - q.sent_back} of ${q.approved} approved without changes · ${q.sent_back} sent back first.`,
      pct: q.pct,
      weight: 20,
    },
    {
      icon: Camera,
      label: 'On time at shoots',
      says: s.measured === 0 ? (s.shoots ? `${s.shoots} shoot${s.shoots === 1 ? '' : 's'} before “I’ve reached” existed.` : 'No shoots yet.') : `Reached ${s.on_time} of ${s.measured} shoots within 15 minutes of the call time.`,
      pct: s.pct,
      weight: 20,
    },
  ]
  if (a) {
    const days = a.present + a.late + a.absent
    parts.push({
      icon: CalendarCheck,
      label: 'Attendance',
      says: days === 0 ? 'No working days yet.' : `${a.present + a.late} of ${days} days in${a.late ? ` · ${a.late} late` : ''}${a.absent ? ` · ${a.absent} absent` : ''}.`,
      pct: a.pct,
      weight: 20,
    })
  }
  return parts
}

/** Each part with its bar and its sentence. */
export function ScoreParts({ card }: { card: MemberScorecard }) {
  return (
    <ul className="flex flex-col gap-3">
      {scoreParts(card).map((p) => {
        const tone = scoreTone(p.pct)
        return (
          <li key={p.label} className="flex items-start gap-3">
            <IconTile icon={p.icon} tone={tone} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{p.label}</span>
                <span className={cn('tabular-nums', TEXT[tone])}>{p.pct == null ? '—' : `${p.pct}%`}</span>
              </p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn('h-full rounded-full', BAR[tone])} style={{ width: `${p.pct ?? 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.says}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const monthLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' })

/** Six months as bars: the trend at a glance. */
export function MonthBars({ months }: { months: MemberScorecard[] }) {
  return (
    <div className="flex h-28 items-end gap-2">
      {months.map((m) => {
        const tone = scoreTone(m.score)
        return (
          <div key={m.from} className="flex flex-1 flex-col items-center gap-1">
            <span className={cn('text-xs tabular-nums', TEXT[tone])}>{m.score ?? '—'}</span>
            <div className="flex h-16 w-full items-end rounded-md bg-muted">
              <div className={cn('w-full rounded-md', BAR[tone])} style={{ height: `${m.score ?? 0}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground">{monthLabel(m.from)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** "What moves it": the work that is late right now. */
export function LateNow({ card }: { card: MemberScorecard }) {
  if (card.late_now.length === 0) return null
  return (
    <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
      <p className="font-medium">Late right now</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
        {card.late_now.map((l) => (
          <li key={`${l.title}-${l.project}`}>
            {l.title}
            {l.project ? ` · ${l.project}` : ''} · <span className="text-tone-rose">{l.days_late} day{l.days_late === 1 ? '' : 's'} late</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
