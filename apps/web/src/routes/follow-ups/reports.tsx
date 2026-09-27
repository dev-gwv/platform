import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { CrmStatsQuery } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useLeads } from '@/features/crm/api'
import { ReportsTab } from '@/features/crm/tabs/ReportsTab'
import { TeamTab } from '@/features/crm/tabs/TeamTab'
import { ForecastTab } from '@/features/crm/tabs/ForecastTab'

/**
 * How the leads are going: the funnel, the team, and what may close.
 *
 * These three screens were built, tested and then left unreachable — no route,
 * no import, nothing in the app could open them — while the API behind them
 * (crm_stats, crm_team_stats, crm_forecast) stayed live the whole time. The
 * funnel by stage, source performance, lost-reason analysis, per-member first
 * response and within-SLA figures, and a stage-weighted forecast were all being
 * computed for nobody.
 *
 * They are here and not on the Leads page on purpose. The leads page is the
 * screen a studio opens to find out who to ring, and the complaint that started
 * this work was that it had too much on it. A report is something you go and
 * look at.
 */
const SECTIONS = [
  { key: 'funnel', label: 'Funnel & sources', hint: 'Where leads come from, where they stop, and why they were lost' },
  { key: 'team', label: 'Team', hint: 'Who is carrying what, how fast they answer, and who converts' },
  { key: 'forecast', label: 'Forecast', hint: 'What could close, weighted by the stage each deal is in' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']
const isSection = (v: unknown): v is SectionKey => SECTIONS.some((s) => s.key === v)

/** The ranges a studio actually asks for, in days. */
const RANGES = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last 12 months' },
] as const

export function CrmReportsPage() {
  return (
    <AuthedPage module="crm">
      <CrmReports />
    </AuthedPage>
  )
}

function CrmReports() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const raw = (search as { section?: unknown }).section
  const [fallback, setFallback] = useState<SectionKey>('funnel')
  const section: SectionKey = isSection(raw) ? raw : fallback
  const [days, setDays] = useState<number>(30)

  function open(next: SectionKey) {
    setFallback(next)
    void navigate({ to: '/follow-ups/reports', search: { section: next } as never, replace: true })
  }

  // One range for the page, so the funnel and the team table can never be
  // describing two different fortnights.
  const range = useMemo<CrmStatsQuery>(() => {
    const to = new Date()
    const from = new Date(to)
    from.setDate(from.getDate() - (days - 1))
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    return { from: iso(from), to: iso(to) }
  }, [days])

  // Only the funnel reads the rows themselves; the other two are server
  // aggregates, so nothing is fetched for a tab nobody opened.
  const needsLeads = section === 'funnel'
  const leads = useLeads(false)

  return (
    <>
      <PageHeader
        title="Lead reports"
        description="How the leads are going. The day's work is on the Leads page."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
              {RANGES.map((r) => (
                <option key={r.days} value={r.days}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Button variant="outline" asChild>
              <Link to="/follow-ups">
                <ArrowLeft /> Back to leads
              </Link>
            </Button>
          </div>
        }
      />

      <div
        role="tablist"
        aria-label="Lead report sections"
        className="mt-4 flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1.5"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            id={`crm-report-${s.key}`}
            type="button"
            role="tab"
            aria-selected={section === s.key}
            aria-controls="crm-report-panel"
            title={s.hint}
            onClick={() => open(s.key)}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              section === s.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{SECTIONS.find((s) => s.key === section)?.hint}</p>

      <div id="crm-report-panel" role="tabpanel" aria-labelledby={`crm-report-${section}`} className="mt-4">
        {section === 'team' ? (
          <TeamTab range={range} />
        ) : section === 'forecast' ? (
          <ForecastTab range={range} />
        ) : needsLeads && leads.isLoading ? (
          <SkeletonList rows={5} columns={4} />
        ) : needsLeads && leads.isError ? (
          <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />
        ) : (
          <ReportsTab leads={leads.data ?? []} range={range} />
        )}
      </div>
    </>
  )
}
