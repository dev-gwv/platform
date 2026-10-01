import { Link } from '@tanstack/react-router'
import type { CrmStats } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { TONE_BG, TONE_CHIP, type ToneName } from '@/shared/ui/tones'
import { prettyWord, useLookupColor } from '../fields'
import { bucketSeries, followUpSentence, qualityRows, type Bucket } from '../report-model'

/**
 * The four questions an owner asks of their leads, each answered in a sentence
 * first and a picture second: are the follow-ups being kept, what is the open
 * pipeline worth, how warm are the leads, and is the team busy and winning.
 */
export function LeadPulse({ data }: { data: CrmStats }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FollowUpCard h={data.follow_up_health} />
      <PipelineCard data={data} />
      <TemperatureCard breakdown={data.quality_breakdown} />
      <TrendCard data={data} />
    </div>
  )
}

function FollowUpCard({ h }: { h: CrmStats['follow_up_health'] }) {
  // Red only for a real problem (overdue); amber for the one next thing (today).
  const chips: Array<{ label: string; n: number; tone: string }> = [
    { label: 'Overdue', n: h.overdue, tone: h.overdue ? 'border-destructive/40 bg-destructive/10 text-destructive' : '' },
    { label: 'Today', n: h.due_today, tone: h.due_today ? TONE_CHIP.amber : '' },
    { label: 'Tomorrow', n: h.due_tomorrow, tone: '' },
    { label: 'This week', n: h.upcoming_7d, tone: '' },
    { label: 'Not set', n: h.no_follow_up, tone: h.no_follow_up ? TONE_CHIP.amber : '' },
  ]
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-medium">Follow-ups</p>
        <p className="mt-1 text-sm">{followUpSentence(h)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c.label}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', c.tone || 'border-border bg-card text-muted-foreground')}
            >
              <span className="font-semibold tabular-nums">{c.n}</span> {c.label}
            </span>
          ))}
        </div>
        {h.overdue + h.due_today > 0 && (
          <Link to="/follow-ups" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
            Open today’s calls →
          </Link>
        )}
      </CardContent>
    </Card>
  )
}

function PipelineCard({ data }: { data: CrmStats }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-medium">Open pipeline</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{formatINR(data.pipeline_value)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.pipeline_value > 0 ? 'The value of every lead still open.' : 'No open lead has a value yet — add one on the lead to see it here.'}
          {data.proposal_count > 0 &&
            ` ${data.proposal_count} ${data.proposal_count === 1 ? 'proposal is' : 'proposals are'} out, worth ${formatINR(data.proposal_value)}.`}
        </p>
      </CardContent>
    </Card>
  )
}

const QUALITY_TONE: Record<string, ToneName> = { hot: 'rose', warm: 'amber', cold: 'blue', unset: 'slate' }

function TemperatureCard({ breakdown }: { breakdown: Record<string, number> }) {
  const colorOf = useLookupColor('lead_quality')
  const rows = qualityRows(breakdown)
  const total = rows.reduce((s, r) => s + r.count, 0)
  const tone = (k: string): ToneName => (k === 'unset' ? 'slate' : (colorOf(k) ?? QUALITY_TONE[k] ?? 'slate'))
  const label = (k: string) => (k === 'unset' ? 'Not set' : prettyWord(k))
  const hot = breakdown.hot ?? 0
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-medium">How warm the open leads are</p>
        {total === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No open leads right now.</p>
        ) : (
          <>
            <p className="mt-1 text-sm">
              {hot ? `${hot} hot of ${total} open — they are first in the call queue.` : `${total} open, none marked hot yet.`}
            </p>
            {/* One bar, parts in proportion, a 2px gap between them. */}
            <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={rows.map((r) => `${label(r.key)} ${r.count}`).join(', ')}>
              {rows.map((r) => (
                <div
                  key={r.key}
                  className={cn('h-full first:rounded-l-full last:rounded-r-full', TONE_BG[tone(r.key)])}
                  style={{ width: `${(r.count / total) * 100}%` }}
                  title={`${label(r.key)}: ${r.count}`}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {rows.map((r) => (
                <span key={r.key} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', TONE_CHIP[tone(r.key)])}>
                  <span className="font-semibold tabular-nums">{r.count}</span> {label(r.key)}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TrendCard({ data }: { data: CrmStats }) {
  const activity = bucketSeries(data.activity_trend, ['count'] as const, data.from, data.to)
  const results = bucketSeries(data.won_lost_trend, ['won', 'lost'] as const, data.from, data.to)
  const touches = activity.reduce((s, b) => s + b.count, 0)
  const won = results.reduce((s, b) => s + b.won, 0)
  const lost = results.reduce((s, b) => s + b.lost, 0)
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-medium">Activity and results</p>
        <p className="mt-1 text-sm">
          {touches} {touches === 1 ? 'call, message or note' : 'calls, messages and notes'} in this period · {won} won · {lost} lost.
        </p>
        {touches > 0 && <p className="mt-3 text-xs text-muted-foreground">Activity</p>}
        {touches > 0 && <Columns buckets={activity} series={[{ key: 'count', name: 'Activity', bg: 'bg-primary' }]} />}
        {won + lost > 0 && (
          <>
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span>Results</span>
              <Legend bg={TONE_BG.green} name="Won" />
              <Legend bg={TONE_BG.slate} name="Lost" />
            </div>
            <Columns
              buckets={results}
              series={[
                { key: 'won', name: 'Won', bg: TONE_BG.green },
                { key: 'lost', name: 'Lost', bg: TONE_BG.slate },
              ]}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Legend({ bg, name }: { bg: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('size-2 rounded-sm', bg)} aria-hidden /> {name}
    </span>
  )
}

/** Thin columns from a shared baseline; hover a column for its numbers. */
function Columns<K extends string>({ buckets, series }: { buckets: Array<Bucket<K>>; series: Array<{ key: K; name: string; bg: string }> }) {
  const max = Math.max(1, ...buckets.flatMap((b) => series.map((s) => b[s.key])))
  if (buckets.length === 0) return null
  return (
    <div className="mt-1 flex h-16 items-end gap-0.5 border-b border-border" role="img" aria-label={series.map((s) => s.name).join(' and ') + ' over time'}>
      {buckets.map((b) => (
        <div
          key={b.key}
          className="group flex h-full min-w-0 flex-1 items-end justify-center gap-px hover:bg-muted/60"
          title={`${b.label}: ${series.map((s) => `${b[s.key]} ${s.name.toLowerCase()}`).join(' · ')}`}
        >
          {series.map((s) => (
            <div
              key={s.key}
              className={cn('w-full max-w-3 rounded-t-[4px]', s.bg)}
              style={{ height: b[s.key] ? `${Math.max(6, (b[s.key] / max) * 100)}%` : 0 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
