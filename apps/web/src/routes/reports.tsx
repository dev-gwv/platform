import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Download } from 'lucide-react'
import type { DeliveryReport, MoneyReport, ReportQuery, ReportTab, SalesReport, TeamReport } from '@ipc/contracts'
import { PageHeader } from '@/shared/layout/page-header'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { SkeletonCards, SkeletonList, SkeletonTiles } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { downloadCsv } from '@/shared/ui/csv'
import { periodFor, rangeLabel, type PeriodKey } from '@/features/financials/period'
import { useDeliveryReport, useMoneyReport, useReportTabs, useSalesReport, useTeamReport } from '@/features/reports/api'
import { deliveryCsv, moneyCsv, pctText, salesCsv, sourceLabel, teamCsv } from '@/features/reports/csv'

type Preset = 'this_month' | 'last_month' | 'this_quarter' | 'this_fy'

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'this_fy', label: 'This financial year' },
]

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'sales', label: 'Sales' },
  { key: 'money', label: 'Money' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'team', label: 'Team' },
]

/**
 * Reports: how the studio is doing for a period, on one screen.
 *
 * Four tabs, each a handful of numbers and at most one short list, so an
 * owner can read it on a phone between shoots. Every number is the one the
 * screen it links to already shows.
 */
export function ReportsPage() {
  const { loading } = useAuth()
  const allowed = useReportTabs()
  const tabs = TABS.filter((t) => allowed[t.key])
  const [preset, setPreset] = useState<PeriodKey>('this_month')
  const [custom, setCustom] = useState(() => {
    const p = periodFor('this_month')
    return { from: p.from, to: p.to }
  })
  const [tab, setTab] = useState<ReportTab | null>(null)

  if (loading) return <SkeletonCards count={3} />
  if (tabs.length === 0) {
    return <EmptyState title="Not available" description="You don’t have access to reports. Ask the studio owner if you think you should." />
  }

  const period =
    preset === 'custom' ? { from: custom.from, to: custom.to, label: rangeLabel(custom.from, custom.to) } : periodFor(preset as Preset)
  const q: ReportQuery = { from: period.from, to: period.to }
  const active = tab && allowed[tab] ? tab : tabs[0]!.key

  return (
    <>
      <PageHeader title="Reports" description="How the studio is doing, for any period." />

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Period">
            {PRESETS.map((p) => (
              <Pill key={p.key} on={preset === p.key} onClick={() => setPreset(p.key)}>
                {p.label}
              </Pill>
            ))}
            <Pill on={preset === 'custom'} onClick={() => setPreset('custom')}>
              Custom
            </Pill>
          </div>
          {preset === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="h-9 w-full sm:w-44" />
              <span className="text-sm text-muted-foreground">to</span>
              <Input type="date" aria-label="To" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="h-9 w-full sm:w-44" />
            </div>
          )}
          <p className="text-xs text-muted-foreground">Showing {period.label}</p>
        </CardContent>
      </Card>

      <Tabs value={active} onValueChange={(v) => setTab(v as ReportTab)} className="mt-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="flex-1 sm:flex-none">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {allowed.sales && (
          <TabsContent value="sales">
            <SalesTab q={q} label={period.label} on={active === 'sales'} />
          </TabsContent>
        )}
        {allowed.money && (
          <TabsContent value="money">
            <MoneyTab q={q} label={period.label} on={active === 'money'} />
          </TabsContent>
        )}
        {allowed.delivery && (
          <TabsContent value="delivery">
            <DeliveryTab q={q} label={period.label} on={active === 'delivery'} />
          </TabsContent>
        )}
        {allowed.team && (
          <TabsContent value="team">
            <TeamTab q={q} label={period.label} on={active === 'team'} />
          </TabsContent>
        )}
      </Tabs>
    </>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────

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

function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string | undefined }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', tone)}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
}

function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-semibold">{title}</p>
        <div className="mt-2">{children}</div>
        {footer && <div className="mt-3 border-t border-border pt-3 text-sm">{footer}</div>}
      </CardContent>
    </Card>
  )
}

function Row({ left, sub, right, to, params, search }: { left: ReactNode; sub?: ReactNode; right: ReactNode; to?: string; params?: Record<string, string>; search?: Record<string, string> }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{left}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span className="shrink-0 text-right tabular-nums">{right}</span>
    </>
  )
  return (
    <li>
      {to ? (
        <Link to={to} params={params} search={search} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted">
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 py-2 text-sm">{body}</div>
      )}
    </li>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>
}

function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  )
}

/** Loading, error, or the tab, with its Download button on top. */
function TabBody<T>({
  query,
  csv,
  children,
}: {
  query: { data: T | undefined; isLoading: boolean; isError: boolean; isFetching: boolean; refetch: () => unknown }
  csv: (data: T) => { name: string; text: string }
  children: (data: T) => ReactNode
}) {
  const data = query.data
  if (query.isLoading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonTiles count={4} />
        <SkeletonList rows={4} />
      </div>
    )
  }
  if (query.isError || !data) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className={cn('flex flex-col gap-4 transition-opacity', query.isFetching && 'opacity-70')}>
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const f = csv(data)
            downloadCsv(f.name, f.text)
          }}
        >
          <Download /> Download CSV
        </Button>
      </div>
      {children(data)}
    </div>
  )
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

// ── Sales ─────────────────────────────────────────────────────────────

function SalesTab({ q, label, on }: { q: ReportQuery; label: string; on: boolean }) {
  const query = useSalesReport(q, on)
  const canLeads = useAccess().hasModule('crm')
  return (
    <TabBody<SalesReport> query={query} csv={(r) => ({ name: `sales-${r.from}-to-${r.to}.csv`, text: salesCsv(r, label) })}>
      {(r) => (
        <>
          <Tiles>
            <Tile label="Enquiries received" value={r.enquiries} />
            <Tile label="Turned into bookings" value={r.booked} hint={r.enquiries > 0 ? `${pctText(r.conversion_pct)} of enquiries` : undefined} />
            <Tile label="New projects" value={r.bookings} />
            <Tile label="Booking value" value={formatINR(r.booking_value)} hint="Total of new projects" />
          </Tiles>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Where enquiries came from" footer={canLeads ? <MoreLink to="/follow-ups">Open leads</MoreLink> : undefined}>
              {r.sources.length === 0 ? (
                <Empty>No enquiries in this period.</Empty>
              ) : (
                <ul>
                  {r.sources.map((s) => (
                    <Row key={s.source} left={sourceLabel(s.source)} sub={`${s.booked} booked`} right={s.enquiries} />
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Why leads were lost">
              {r.lost_reasons.length === 0 ? (
                <Empty>No leads were lost in this period.</Empty>
              ) : (
                <ul>
                  {r.lost_reasons.map((l) => (
                    <Row key={l.reason} left={l.reason} right={l.count} />
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </TabBody>
  )
}

// ── Money ─────────────────────────────────────────────────────────────

function MoneyTab({ q, label, on }: { q: ReportQuery; label: string; on: boolean }) {
  const query = useMoneyReport(q, on)
  const canPnl = useAccess().hasModule('financials')
  return (
    <TabBody<MoneyReport> query={query} csv={(r) => ({ name: `money-${r.from}-to-${r.to}.csv`, text: moneyCsv(r, label) })}>
      {(r) => (
        <>
          <Tiles>
            <Tile label="Billed" value={formatINR(r.billed)} hint={`${r.invoices} invoice${r.invoices === 1 ? '' : 's'} issued`} />
            <Tile label="Received" value={formatINR(r.received)} tone="text-tone-green" hint="Payments that came in" />
            <Tile
              label="Still to collect"
              value={formatINR(r.to_collect)}
              tone="text-tone-amber"
              hint={r.overdue > 0 ? <span className="text-destructive">{formatINR(r.overdue)} overdue</span> : 'Nothing overdue'}
            />
            <Tile label="Expenses" value={formatINR(r.expenses)} hint="Bills and purchases" />
          </Tiles>
          <Section
            title="Who owes you"
            footer={canPnl ? <MoreLink to="/financials">See full profit &amp; loss</MoreLink> : <MoreLink to="/billing">Open billing</MoreLink>}
          >
            {r.owes.length === 0 ? (
              <Empty>Nobody owes you anything right now.</Empty>
            ) : (
              <ul>
                {r.owes.map((o) => (
                  <Row
                    key={o.client_id}
                    left={o.client_name}
                    sub={o.overdue_days != null && o.overdue > 0 ? <span className="text-destructive">{formatINR(o.overdue)} overdue · {days(o.overdue_days)}</span> : 'Not overdue yet'}
                    right={formatINR(o.outstanding)}
                    {...(o.invoice_id
                      ? { to: '/billing/invoices/$id', params: { id: o.invoice_id } }
                      : o.project_id
                        ? { to: '/projects/$id', params: { id: o.project_id }, search: { tab: 'billing' } }
                        : {})}
                  />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </TabBody>
  )
}

// ── Delivery ──────────────────────────────────────────────────────────

function DeliveryTab({ q, label, on }: { q: ReportQuery; label: string; on: boolean }) {
  const query = useDeliveryReport(q, on)
  return (
    <TabBody<DeliveryReport> query={query} csv={(r) => ({ name: `delivery-${r.from}-to-${r.to}.csv`, text: deliveryCsv(r, label) })}>
      {(r) => (
        <>
          <Tiles>
            <Tile label="Delivered" value={r.delivered} hint="To clients, in this period" />
            <Tile label="On time" value={pctText(r.on_time_pct)} hint={r.with_due_date > 0 ? `${r.on_time} of ${r.with_due_date} with a due date` : 'None had a due date'} />
            <Tile label="Late right now" value={r.late_now} tone={r.late_now > 0 ? 'text-destructive' : undefined} hint="Past the due date, not delivered" />
            <Tile label="Shoot to delivery" value={r.avg_days_to_deliver == null ? '—' : days(Math.round(r.avg_days_to_deliver))} hint="On average" />
          </Tiles>
          <Section title="Late right now" footer={<MoreLink to="/project-tracking">Open project tracking</MoreLink>}>
            {r.late.length === 0 ? (
              <Empty>Nothing is late. Well done.</Empty>
            ) : (
              <ul>
                {r.late.map((l) => (
                  <Row
                    key={l.id}
                    left={l.title}
                    sub={[l.project_name, l.client_name, l.assignee_name ? `with ${l.assignee_name}` : null].filter(Boolean).join(' · ')}
                    right={<span className="text-destructive">{days(l.days_late)} late</span>}
                    to="/projects/$id"
                    params={{ id: l.project_id }}
                  />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </TabBody>
  )
}

// ── Team ──────────────────────────────────────────────────────────────

function TeamTab({ q, label, on }: { q: ReportQuery; label: string; on: boolean }) {
  const query = useTeamReport(q, on)
  return (
    <TabBody<TeamReport> query={query} csv={(r) => ({ name: `team-${r.from}-to-${r.to}.csv`, text: teamCsv(r, label) })}>
      {(r) => (
        <Section title="Each person">
          {r.members.length === 0 ? (
            <Empty>No team members yet.</Empty>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">Name</th>
                    <th className="py-2 pr-3 text-right font-semibold">Shoots</th>
                    <th className="py-2 pr-3 text-right font-semibold">Work delivered</th>
                    <th className="py-2 pr-3 text-right font-semibold">Late now</th>
                    <th className="py-2 text-right font-semibold">Present / leave</th>
                  </tr>
                </thead>
                <tbody>
                  {r.members.map((m) => (
                    <tr key={m.user_id} className="border-b border-border/60 last:border-0">
                      <td className="max-w-[10rem] truncate py-2 pr-3 font-medium">{m.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.shoots}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.delivered}</td>
                      <td className={cn('py-2 pr-3 text-right tabular-nums', m.late_now > 0 && 'font-semibold text-destructive')}>{m.late_now}</td>
                      <td className="py-2 text-right tabular-nums">
                        {m.days_present} / {m.leave_days}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Days present come from Attendance; leave is approved leave on working days.</p>
        </Section>
      )}
    </TabBody>
  )
}
