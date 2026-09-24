import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { cn } from '@/shared/ui/cn'
import { ErrorState } from '@/shared/ui/states'
import { useLeads } from '@/features/crm/api'
import { AddLeadDialog } from '@/features/crm/AddLeadDialog'
import { LeadDrawer } from '@/features/crm/LeadDrawer'
import { EMPTY_QUERY, countsFor, summarise, type LeadQuery } from '@/features/crm/leads'
import { InboxTab } from '@/features/crm/tabs/InboxTab'
import { FollowUpBoardTab, PipelineTab, TodayTab } from '@/features/crm/tabs/BoardTabs'
import { ReportsTab } from '@/features/crm/tabs/ReportsTab'
import { TeamTab } from '@/features/crm/tabs/TeamTab'
import { ForecastTab } from '@/features/crm/tabs/ForecastTab'

/**
 * Four tabs, from fourteen.
 *
 * The other ten were not features anyone lost -- they were the same leads
 * sliced ten ways, plus five things a studio configures once. Today and All
 * leads are where the work happens; Pipeline is the stage board; Reports is
 * the three number screens (reports, forecast, per-person) stacked, because
 * nobody opens one without wanting the others.
 *
 * Gone from here, not from the app: Distribution, Templates, Imports,
 * Duplicates and CRM Settings live on /follow-ups/setup. Activities is the
 * lead's own Timeline and the studio-wide /activity page. Quotes are on the
 * lead, where the quote belongs, and in Billing.
 */
const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'inbox', label: 'All leads' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'reports', label: 'Reports' },
] as const

type TabKey = (typeof TABS)[number]['key']
const isTab = (v: unknown): v is TabKey => TABS.some((t) => t.key === v)

export function FollowUpsPage() {
  return (
    <AuthedPage module="crm">
      <Crm />
    </AuthedPage>
  )
}

/** The tab lives in the URL (?tab=), so a reload and a shared link both land on it. */
function useTab(): [TabKey, (t: TabKey) => void] {
  const { search } = useLocation()
  const navigate = useNavigate()
  const current = (search as { tab?: unknown }).tab
  const tab: TabKey = isTab(current) ? current : 'today'
  const setTab = (t: TabKey) =>
    void navigate({ to: '/follow-ups', search: (t === 'today' ? {} : { tab: t }) as never, replace: true })
  return [tab, setTab]
}

function Crm() {
  const [tab, setTab] = useTab()
  const { search } = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState<LeadQuery>(EMPTY_QUERY)
  const [openLead, setOpenLead] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  // A ?lead= link (from a reminder, a converted enquiry, elsewhere) opens
  // straight to that deal -- even an archived one -- then clears itself so
  // closing the drawer and reloading doesn't reopen it.
  const linkedLeadId = (search as { lead?: unknown }).lead
  const hasLeadLink = typeof linkedLeadId === 'string' && linkedLeadId.length > 0
  useEffect(() => {
    if (!hasLeadLink) return
    setOpenLead(linkedLeadId as string)
    void navigate({ to: '/follow-ups', search: (tab === 'today' ? {} : { tab }) as never, replace: true })
  }, [hasLeadLink]) // tab/navigate/linkedLeadId intentionally excluded: this fires once, off the initial URL

  const active = useLeads(false)
  // The archived rows cost a second request, so they are only fetched when
  // someone asks to see them or a direct link needs to find one.
  const everything = useLeads(showArchived || hasLeadLink)
  const leads = useMemo(() => active.data ?? [], [active.data])
  const allLeads = useMemo(() => everything.data ?? [], [everything.data])

  // One clock for the whole page, so a lead cannot be "due today" in the strip
  // and "overdue" in the table because two components asked at different times.
  const now = useMemo(() => new Date(), [active.data])
  const totals = useMemo(() => summarise(leads, now), [leads, now])
  const chipCounts = useMemo(() => countsFor(leads, now), [leads, now])

  const inboxLeads = showArchived ? allLeads : leads
  const selected = [...allLeads, ...leads].find((l) => l.id === openLead) ?? null

  return (
    <>
      <PageHeader
        title="Leads"
        description="Everyone who got in touch, and who you owe a call."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/follow-ups/setup">
                <Settings2 /> Setup
              </Link>
            </Button>
            <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} onAdded={(id) => setOpenLead(id)} />
          </div>
        }
      />

      <div role="tablist" aria-label="Leads" className="no-print mt-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`crm-tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls="crm-tabpanel"
            onClick={() => setTab(t.key)}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="crm-tabpanel" role="tabpanel" aria-labelledby={`crm-tab-${tab}`} className="mt-4">
        {active.isLoading ? (
          <SkeletonList rows={5} columns={5} />
        ) : active.isError ? (
          <ErrorState error={active.error} onRetry={() => void active.refetch()} />
        ) : tab === 'today' ? (
          <div className="flex flex-col gap-6">
            {/*
              * The six figures live here, not above every tab.
              *
              * They describe today's work -- late, due, never called -- so on
              * the pipeline board or a report they were a row of numbers about
              * a different question, with a Show summary toggle hiding six more.
              */}
            <TodayCounts totals={totals} />
            <TodayTab leads={leads} now={now} onOpen={setOpenLead} />
            <div>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">What is coming</h2>
              <FollowUpBoardTab leads={leads} now={now} onOpen={setOpenLead} />
            </div>
          </div>
        ) : tab === 'inbox' ? (
          <InboxTab
            leads={inboxLeads}
            now={now}
            query={query}
            onQuery={setQuery}
            counts={chipCounts}
            onOpen={setOpenLead}
            showArchived={showArchived}
            onShowArchived={setShowArchived}
          />
        ) : tab === 'pipeline' ? (
          <PipelineTab leads={leads} onOpen={setOpenLead} />
        ) : (
          <div className="flex flex-col gap-8">
            <ReportsTab leads={leads} />
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Forecast</h2>
              <ForecastTab />
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Per person</h2>
              <TeamTab />
            </section>
          </div>
        )}
      </div>

      {selected && <LeadDrawer lead={selected} onClose={() => setOpenLead(null)} />}
    </>
  )
}

/** Late, due, never called -- the three that decide what happens next. */
function TodayCounts({ totals }: { totals: ReturnType<typeof summarise> }) {
  const stats: Array<[string, number, string]> = [
    ['Overdue', totals.overdue, 'text-destructive'],
    ['Due today', totals.today, 'text-primary'],
    ['Never contacted', totals.uncontacted, 'text-warning'],
    ['Hot', totals.hot, 'text-destructive'],
    ['Open', totals.total, 'text-foreground'],
    ['Won this month', totals.wonThisMonth, 'text-success'],
  ]
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
      {stats.map(([label, value, tone]) => (
        <span key={label} className="flex items-baseline gap-1.5">
          <span className={cn('text-lg font-semibold tabular-nums', tone)}>{value}</span>
          <span className="text-sm text-muted-foreground">{label}</span>
        </span>
      ))}
    </div>
  )
}
