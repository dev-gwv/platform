import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ScorecardTeamRow } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { Avatar } from '@/shared/ui/avatar'
import { cn } from '@/shared/ui/cn'
import { usePerformanceHistory, useTeamPerformance } from '@/features/performance/api'
import { LateNow, MonthBars, ScoreNumber, ScoreParts } from '@/features/performance/Scorecard'

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const monthTitle = (key: string) => new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

/** /team/performance: everyone's month, best first, each one open for detail. */
export function TeamPerformancePage() {
  return (
    <AuthedPage module="team_directory">
      <TeamPerformance />
    </AuthedPage>
  )
}

function TeamPerformance() {
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [open, setOpen] = useState<string | null>(null)
  const q = useTeamPerformance(month)
  const shift = (n: number) => {
    const d = new Date(`${month}-01T00:00:00`)
    d.setMonth(d.getMonth() + n)
    setMonth(monthKey(d))
  }
  const isNow = month === monthKey(new Date())
  return (
    <>
      <PageHeader
        title="Performance"
        actions={
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            <Button size="icon" variant="ghost" className="size-8" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium">{monthTitle(month)}</span>
            <Button size="icon" variant="ghost" className="size-8" aria-label="Next month" disabled={isNow} onClick={() => shift(1)}>
              <ChevronRight />
            </Button>
          </div>
        }
      />
      {q.isPending ? (
        <SkeletonList rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <Card>
          <EmptyState title="Nobody to score yet" description="Add your team, give them work, and this fills itself." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {q.data.items.map((r) => (
              <Row key={r.user_id} row={r} open={open === r.user_id} onToggle={() => setOpen(open === r.user_id ? null : r.user_id)} />
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        The score is out of 100: work on time counts 40, right first time 20, on time at shoots 20, attendance 20. A part with
        nothing to measure yet is left out, so nobody loses marks for work they were not given.
      </p>
    </>
  )
}

function fact(label: string, value: string | null) {
  return (
    <span className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums">{value ?? '—'}</span>
    </span>
  )
}

function Row({ row, open, onToggle }: { row: ScorecardTeamRow; open: boolean; onToggle: () => void }) {
  const c = row.card
  const days = c.attendance ? c.attendance.present + c.attendance.late + c.attendance.absent : 0
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-left hover:bg-muted/40">
        <span className="flex min-w-40 flex-1 items-center gap-3">
          <Avatar name={row.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.name}</span>
            <span className="block text-xs text-muted-foreground">{row.engagement_type === 'freelancer' ? 'Freelancer' : 'In-house'}</span>
          </span>
        </span>
        <ScoreNumber score={c.score} className="w-16 text-2xl" />
        <span className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          {fact('Work on time', c.work.with_due ? `${c.work.on_time} of ${c.work.with_due}` : null)}
          {fact('Sent back', c.quality.approved ? String(c.quality.sent_back) : null)}
          {fact('Shoots on time', c.shoots.measured ? `${c.shoots.on_time} of ${c.shoots.measured}` : null)}
          {fact('Days in', c.attendance && days ? `${c.attendance.present + c.attendance.late} of ${days}` : null)}
        </span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <Detail userId={row.user_id} />}
    </li>
  )
}

function Detail({ userId }: { userId: string }) {
  const h = usePerformanceHistory(userId)
  if (h.isPending) return <p className="px-4 pb-4 text-sm text-muted-foreground">Loading…</p>
  if (!h.data) return null
  const now = h.data.months[h.data.months.length - 1]!
  return (
    <div className="grid gap-4 border-t border-border bg-muted/20 px-4 py-4 md:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last six months</p>
        <MonthBars months={h.data.months} />
      </div>
      <div className="flex flex-col gap-3">
        <ScoreParts card={now} />
        <LateNow card={now} />
      </div>
    </div>
  )
}

/** /performance/me: my own last six months. */
export function MyPerformancePage() {
  return (
    <AuthedPage module="dashboard">
      <MyPerformance />
    </AuthedPage>
  )
}

function MyPerformance() {
  const h = usePerformanceHistory(null)
  const now = h.data?.months[h.data.months.length - 1]
  return (
    <>
      <PageHeader title="My performance" />
      {h.isPending ? (
        <SkeletonList rows={4} />
      ) : h.isError ? (
        <ErrorState error={h.error} onRetry={() => void h.refetch()} />
      ) : (
        now && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>This month</CardTitle>
                <ScoreNumber score={now.score} className="text-3xl" />
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ScoreParts card={now} />
                <LateNow card={now} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Last six months</CardTitle>
              </CardHeader>
              <CardContent>
                <MonthBars months={h.data.months} />
              </CardContent>
            </Card>
          </div>
        )
      )}
    </>
  )
}
