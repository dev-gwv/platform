import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { TONE_BG, type ToneName } from '@/shared/ui/tones'
import { useMonthlyProfitSummary } from './api'
import { useINR } from '@/shared/money/MoneyMask'

/** How a person is paid decides the bucket (the API reads it off their profile). */
const BUCKETS: Array<{ key: string; label: string; tone: ToneName }> = [
  { key: 'salaried', label: 'Salaried team', tone: 'blue' },
  { key: 'contractor', label: 'Freelancers (per shoot, day or project)', tone: 'violet' },
  { key: 'commission', label: 'On commission', tone: 'teal' },
  { key: 'intern', label: 'Interns (stipend)', tone: 'amber' },
  { key: 'other', label: 'Other', tone: 'slate' },
]

/**
 * The month's team cost split by how people are paid: what the studio's
 * fixed salaries cost against what it pays freelancers by the shoot. The
 * split owners ask about when deciding whether to hire or keep booking.
 */
export function TeamCostCard({ month }: { month: string }) {
  const inr = useINR()
  const q = useMonthlyProfitSummary(month)
  const raw = q.data?.salary_buckets ?? []
  const amount = new Map(raw.map((b) => [String(b['bucket'] ?? 'other'), Number(b['total'] ?? 0)]))
  const rows = BUCKETS.map((b) => ({ ...b, total: amount.get(b.key) ?? 0 })).filter((b) => b.total > 0)
  const total = rows.reduce((s, r) => s + r.total, 0)
  const monthName = new Date(`${month.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long' })

  if (q.isLoading || q.isError || total === 0) return null
  const top = [...rows].sort((a, b) => b.total - a.total)[0]!

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-semibold">Team cost in {monthName}</p>
        <p className="mt-1 text-sm">
          {inr(total)} paid out to the team; {Math.round((top.total / total) * 100)}% went to {top.label.toLowerCase()}.
        </p>
        <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={rows.map((r) => `${r.label} ${inr(r.total)}`).join(', ')}>
          {rows.map((r) => (
            <div
              key={r.key}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', TONE_BG[r.tone])}
              style={{ width: `${(r.total / total) * 100}%` }}
              title={`${r.label}: ${inr(r.total)}`}
            />
          ))}
        </div>
        <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2">
              <span className={cn('size-2.5 shrink-0 rounded-sm', TONE_BG[r.tone])} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="tabular-nums">{inr(r.total)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
