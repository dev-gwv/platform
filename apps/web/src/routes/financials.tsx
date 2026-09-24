import { useMemo, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowDownRight, ArrowUpRight, Download, Info, Landmark, Users, Wallet } from 'lucide-react'
import type { PnlBasis, PnlLines, ProfitAndLoss } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { ShareChart } from '@/shared/ui/chart'
import { SkeletonList, SkeletonTiles } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { useProfitAndLoss } from '@/features/financials/api'
import { OverheadsCard } from '@/features/financials/Overheads'
import { PERIOD_LABEL, periodFor, rangeLabel, type PeriodKey } from '@/features/financials/period'

export function FinancialsPage() {
  return (
    <AuthedPage module="financials">
      <ProfitAndLossPage />
    </AuthedPage>
  )
}

const PRESETS = Object.keys(PERIOD_LABEL) as Exclude<PeriodKey, 'custom'>[]

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—')
const signed = (n: number) => (n < 0 ? `−${formatINR(Math.abs(n))}` : formatINR(n))

/**
 * Profit & Loss: what came in, what it cost, what is left -- for a month, a
 * quarter or the financial year, every rupee counted once.
 *
 * Read on cash (money that actually moved) or booked (the work done in the
 * period). Each line opens the list behind it; beside the statement, what is
 * still to come in and what is still owed; below, the year's trend, where
 * the money goes, the fixed overheads, and every project's own profit.
 */
function ProfitAndLossPage() {
  const [preset, setPreset] = useState<PeriodKey>('this_month')
  const [custom, setCustom] = useState(() => {
    const p = periodFor('this_month')
    return { from: p.from, to: p.to }
  })
  const [basis, setBasis] = useState<PnlBasis>('cash')
  const period = preset === 'custom' ? { ...custom, label: rangeLabel(custom.from, custom.to) } : periodFor(preset)
  const q = useProfitAndLoss({ from: period.from, to: period.to, basis })
  const data = q.data

  function exportCsv() {
    if (!data) return
    const l = data.lines
    const statement = toCsv(
      ['Line', 'Amount (₹)'],
      [
        ['Income', l.income],
        ['Team for shoots', -l.team_crew],
        ['Other team payouts', -l.team_payouts],
        ['Project expenses', -l.project_expenses],
        ['Gross profit', l.gross_profit],
        ['Salaries', -l.salaries],
        ['Fixed overheads', -l.overheads],
        ['Studio expenses', -l.studio_expenses],
        ['Net profit', l.net_profit],
      ],
    )
    const projects = toCsv(
      ['Project', 'Client', 'Income', 'Team', 'Expenses', 'Profit', 'Margin %', 'Still to collect'],
      data.projects.map((p) => [p.name, p.client_name ?? '', p.income, p.team, p.expenses, p.profit, p.margin ?? '', p.to_collect]),
    )
    downloadCsv(
      `profit-and-loss-${data.from}-to-${data.to}-${data.basis}.csv`,
      `Profit & Loss ${period.label} (${data.basis})\n${statement}\n\nBy project\n${projects}`,
    )
  }

  return (
    <>
      <PageHeader
        title="Profit & Loss"
        description="What came in, what it cost, and what is left — every rupee counted once."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={!data}>
            <Download /> Download
          </Button>
        }
      />

      {/* ── Which period, read which way ───────────────────────── */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Period">
            {PRESETS.map((k) => (
              <Pill key={k} on={preset === k} onClick={() => setPreset(k)}>
                {PERIOD_LABEL[k]}
              </Pill>
            ))}
            <Pill on={preset === 'custom'} onClick={() => setPreset('custom')}>
              Custom
            </Pill>
            {preset === 'custom' && (
              <span className="flex flex-wrap items-center gap-2">
                <Input type="date" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="h-8 w-48" />
                <span className="text-sm text-muted-foreground">to</span>
                <Input type="date" aria-label="To" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="h-8 w-48" />
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-border bg-muted p-0.5" role="radiogroup" aria-label="Basis">
              {(['cash', 'booked'] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={basis === b}
                  onClick={() => setBasis(b)}
                  className={cn(
                    'rounded-full px-3.5 py-1 text-sm font-medium transition-colors',
                    basis === b ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {b === 'cash' ? 'Cash' : 'Booked'}
                </button>
              ))}
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              {basis === 'cash'
                ? 'Cash: money that actually came in and went out in this period.'
                : 'Booked: the work done in this period — each project’s value spread over its shoots, with the crew those shoots cost.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {q.isLoading && !data ? (
        <div className="mt-4 flex flex-col gap-4">
          <SkeletonTiles count={3} />
          <SkeletonList rows={8} />
        </div>
      ) : q.isError || !data ? (
        <div className="mt-4">
          <ErrorState onRetry={() => void q.refetch()} />
        </div>
      ) : (
        <div className={cn('mt-4 flex flex-col gap-4 transition-opacity', q.isFetching && 'opacity-70')}>
          <Headline lines={data.lines} label={period.label} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Statement lines={data.lines} className="lg:col-span-2" />
            <Rail data={data} />
          </div>
          <Trend data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <WhereItGoes data={data} />
            <OverheadsCard />
          </div>
          <Projects data={data} />
        </div>
      )}
    </>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/** Income, costs, and what is left, big enough to read across the room. */
function Headline({ lines: l, label }: { lines: PnlLines; label: string }) {
  const costs = l.income - l.net_profit
  const profit = l.net_profit >= 0
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile label={`Income · ${label}`} value={formatINR(l.income)} tone="text-tone-green" icon={<ArrowDownRight className="size-4" aria-hidden />} />
      <Tile label="Costs" value={formatINR(costs)} tone="text-tone-rose" icon={<ArrowUpRight className="size-4" aria-hidden />} hint={l.income > 0 ? `${pct(costs, l.income)} of income` : undefined} />
      <Tile
        label={profit ? 'Profit' : 'Loss'}
        value={signed(l.net_profit)}
        tone={profit ? 'text-tone-green' : 'text-destructive'}
        strong
        icon={<Wallet className="size-4" aria-hidden />}
        hint={l.income > 0 ? `${pct(l.net_profit, l.income)} margin` : undefined}
      />
    </div>
  )
}

function Tile({ label, value, tone, icon, hint, strong }: { label: string; value: string; tone: string; icon: ReactNode; hint?: string | undefined; strong?: boolean }) {
  return (
    <Card className={cn(strong && 'ring-1 ring-inset ring-current/10')}>
      <CardContent className="p-4">
        <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
          <span className={tone}>{icon}</span> {label}
        </p>
        <p className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', strong && tone)}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/** The statement, as an accountant lays it out; each line opens its list. */
function Statement({ lines: l, className }: { lines: PnlLines; className?: string }) {
  const row = (label: string, amount: number, to: string | null, hint?: string, search?: Record<string, string>) => (
    <li className="flex items-baseline gap-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        {to ? (
          <Link to={to} search={search} className="hover:text-primary hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{amount > 0 ? pct(amount, l.income) : ''}</span>
      <span className="w-32 text-right tabular-nums">{amount > 0 ? `−${formatINR(amount)}` : formatINR(0)}</span>
    </li>
  )
  const total = (label: string, amount: number, big = false) => (
    <li className={cn('flex items-baseline gap-3 border-t border-foreground/15 py-2.5 font-semibold', big && 'text-base')}>
      <span className="flex-1">{label}</span>
      <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{pct(amount, l.income)}</span>
      <span className={cn('w-32 text-right tabular-nums', amount < 0 ? 'text-destructive' : big ? 'text-tone-green' : '')}>{signed(amount)}</span>
    </li>
  )
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <p className="text-sm font-semibold">Statement</p>
        <ul className="mt-2">
          <li className="flex items-baseline gap-3 py-2 text-sm font-medium">
            <span className="flex-1">
              <Link to="/billing" search={{ tab: 'payments' }} className="hover:text-primary hover:underline">
                Income
              </Link>
              {l.gst_collected > 0 && <span className="block text-xs font-normal text-muted-foreground">Includes {formatINR(l.gst_collected)} GST invoiced</span>}
            </span>
            <span className="w-14" />
            <span className="w-32 text-right tabular-nums text-tone-green">{formatINR(l.income)}</span>
          </li>
          <li className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cost of the work</li>
          {row('Team for shoots', l.team_crew, '/team-payouts', 'Crew booked on shoots')}
          {row('Other team payouts', l.team_payouts, '/team-payouts')}
          {row('Project expenses', l.project_expenses, '/company-expenses', 'Travel, prints, albums — spent on a project')}
          {total('Gross profit', l.gross_profit)}
          <li className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Running the studio</li>
          {row('Salaries', l.salaries, '/employees', undefined, { section: 'salaries' })}
          {row('Fixed overheads', l.overheads, null, 'Rent, internet, software — see below')}
          {row('Studio expenses', l.studio_expenses, '/company-expenses', 'Spent on the studio, not a project')}
          {total(l.net_profit >= 0 ? 'Net profit' : 'Net loss', l.net_profit, true)}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Money still out there, and money still owed. */
function Rail({ data }: { data: ProfitAndLoss }) {
  const r = data.rail
  const item = (icon: ReactNode, label: string, value: number, hint: string, to: string, search?: Record<string, string>) => (
    <Link to={to} search={search} className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-muted">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-muted-foreground">{label}</span>
        <span className="block text-lg font-semibold tabular-nums">{formatINR(value)}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </Link>
  )
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-3">
        <p className="px-2 pt-1 text-sm font-semibold">Still to settle</p>
        {item(<Wallet className="size-4 text-tone-amber" aria-hidden />, 'Still to collect', r.still_to_collect, 'Project value not yet received', '/projects')}
        {item(<Users className="size-4 text-tone-violet" aria-hidden />, 'Owed to the team', r.owed_to_team, 'Crew booked, not yet paid', '/team-payouts')}
        {item(<Landmark className="size-4 text-tone-blue" aria-hidden />, 'Not banked yet', r.unbanked, 'Received, not marked as in the bank', '/billing', { tab: 'payments' })}
      </CardContent>
    </Card>
  )
}

/** Twelve months: what came in beside what went out, and the month's result. */
function Trend({ data }: { data: ProfitAndLoss }) {
  const months = data.monthly
  const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.income - m.net_profit)))
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">The last twelve months</p>
          <p className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-tone-green" /> Income
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-tone-rose/70" /> Costs
            </span>
          </p>
        </div>
        <div className="mt-4 flex h-44 items-end gap-1.5 sm:gap-3" role="img" aria-label="Income and costs by month">
          {months.map((m) => {
            const costs = m.income - m.net_profit
            const label = new Date(`${m.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' })
            return (
              <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${label}: in ${formatINR(m.income)}, out ${formatINR(costs)}, ${m.net_profit >= 0 ? 'profit' : 'loss'} ${signed(m.net_profit)}`}>
                <span className={cn('text-[10px] font-semibold tabular-nums', m.net_profit < 0 ? 'text-destructive' : 'text-tone-green', m.income === 0 && costs === 0 && 'invisible')}>
                  {m.net_profit >= 0 ? '+' : '−'}
                  {compact(Math.abs(m.net_profit))}
                </span>
                <div className="flex h-full w-full items-end justify-center gap-0.5">
                  <span className="w-1/2 max-w-4 rounded-t bg-tone-green" style={{ height: `${(m.income / max) * 100}%` }} />
                  <span className="w-1/2 max-w-4 rounded-t bg-tone-rose/70" style={{ height: `${(Math.max(0, costs) / max) * 100}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

/** ₹1.2L, ₹45k -- for the small labels over the bars. */
function compact(n: number): string {
  if (n >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(1)}Cr`
  if (n >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

function WhereItGoes({ data }: { data: ProfitAndLoss }) {
  const l = data.lines
  const points = useMemo(
    () =>
      [
        { label: 'Team for shoots', value: l.team_crew },
        { label: 'Other team payouts', value: l.team_payouts },
        { label: 'Salaries', value: l.salaries },
        ...data.categories.map((c) => ({ label: c.category.charAt(0).toUpperCase() + c.category.slice(1), value: c.amount })),
      ].filter((p) => p.value > 0),
    [data, l],
  )
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-semibold">Where the money goes</p>
        <ShareChart points={points} format={formatINR} className="mt-3" />
      </CardContent>
    </Card>
  )
}

type SortKey = 'profit' | 'income' | 'margin' | 'to_collect'

/** Every project with money in the period: its own little P&L. */
function Projects({ data }: { data: ProfitAndLoss }) {
  const [sort, setSort] = useState<SortKey>('profit')
  const rows = [...data.projects].sort((a, b) => {
    const v = (x: typeof a) => (sort === 'margin' ? (x.margin ?? -Infinity) : x[sort])
    return v(b) - v(a)
  })
  const head = (k: SortKey, label: string) => (
    <button type="button" onClick={() => setSort(k)} className={cn('font-semibold hover:text-foreground', sort === k ? 'text-foreground' : '')} aria-pressed={sort === k}>
      {label}
      {sort === k ? ' ↓' : ''}
    </button>
  )
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-semibold">By project</p>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No project had money in or out in this period.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Project</th>
                  <th className="py-2 pr-3 text-right">{head('income', 'Income')}</th>
                  <th className="py-2 pr-3 text-right font-semibold">Team</th>
                  <th className="py-2 pr-3 text-right font-semibold">Expenses</th>
                  <th className="py-2 pr-3 text-right">{head('profit', 'Profit')}</th>
                  <th className="py-2 pr-3 text-right">{head('margin', 'Margin')}</th>
                  <th className="py-2 text-right">{head('to_collect', 'Still to collect')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.project_id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      <Link to="/projects/$id" params={{ id: p.project_id }} search={{ tab: 'billing' }} className="font-medium hover:text-primary hover:underline">
                        {p.name}
                      </Link>
                      {p.client_name && <span className="block text-xs text-muted-foreground">{p.client_name}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatINR(p.income)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{p.team ? `−${formatINR(p.team)}` : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{p.expenses ? `−${formatINR(p.expenses)}` : '—'}</td>
                    <td className={cn('py-2 pr-3 text-right font-semibold tabular-nums', p.profit < 0 ? 'text-destructive' : 'text-tone-green')}>{signed(p.profit)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.margin == null ? '—' : `${Math.round(p.margin)}%`}</td>
                    <td className={cn('py-2 text-right tabular-nums', p.to_collect > 0 ? 'text-tone-amber' : 'text-muted-foreground')}>{p.to_collect ? formatINR(p.to_collect) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
