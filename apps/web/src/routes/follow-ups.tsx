import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import type { CrmStatsQuery } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { MetricCard } from '@/shared/ui/metric-card'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { ErrorState } from '@/shared/ui/states'
import { useLeads } from '@/features/crm/api'
import { AddLeadDialog } from '@/features/crm/AddLeadDialog'
import { LeadDrawer } from '@/features/crm/LeadDrawer'
import { GettingStarted } from '@/features/crm/GettingStarted'
import { ALL_GROUPS, CrmFilterBar, inGroup } from '@/features/crm/FilterBar'
import { daysBack } from '@/features/crm/tabs/DateRange'
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
  // One group and one date range, read by every tab. Reports, Forecast and Per
  // person each owned a date picker before, so setting one left the other two
  // on their defaults and three sections on one screen disagreed.
  const [group, setGroup] = useState<string>(ALL_GROUPS)
  const [range, setRange] = useState<CrmStatsQuery>(() => daysBack(29))
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
  const allOpen = useMemo(() => active.data ?? [], [active.data])
  const allLeads = useMemo(() => everything.data ?? [], [everything.data])
  const leads = useMemo(() => inGroup(allOpen, group), [allOpen, group])

  // One clock for the whole page, so a lead cannot be "due today" in the strip
  // and "overdue" in the table because two components asked at different times.
  const now = useMemo(() => new Date(), [active.data])
  const totals = useMemo(() => summarise(leads, now), [leads, now])
  const chipCounts = useMemo(() => countsFor(leads, now), [leads, now])

  const inboxLeads = inGroup(showArchived ? allLeads : allOpen, group)
  const selected = [...allLeads, ...allOpen].find((l) => l.id === openLead) ?? null

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

      {/* Under the title, reading as part of it rather than as a control
          competing with the list below. */}
      <SectionTabs
        className="no-print mt-2"
        variant="underline"
        label="Leads"
        tabs={TABS.map((t) => ({ value: t.key, label: t.label }))}
        value={tab}
        onChange={setTab}
      />

      <div className="mt-4 flex flex-col gap-4">
        <CrmFilterBar leads={allOpen} group={group} onGroup={setGroup} range={range} onRange={setRange} />
        <GettingStarted leads={allOpen} />
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
              {/* Overdue and Today are the table above; repeating them as
                  columns put every late lead on the screen twice. */}
              <FollowUpBoardTab leads={leads} now={now} onOpen={setOpenLead} omit={['overdue', 'today']} />
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
            <ReportsTab leads={leads} range={range} />
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Forecast</h2>
              <ForecastTab range={range} />
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Per person</h2>
              <TeamTab range={range} />
            </section>
          </div>
        )}
      </div>

      {selected && <LeadDrawer lead={selected} onClose={() => setOpenLead(null)} />}
    </>
  )
}

/** Late, due, never called -- the figures that decide what happens next. */
function TodayCounts({ totals }: { totals: ReturnType<typeof summarise> }) {
  const pct = (n: number) => (totals.total === 0 ? '' : `${Math.round((n / totals.total) * 100)}% of open leads`)
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Overdue"
        value={totals.overdue}
        tone={totals.overdue > 0 ? 'danger' : 'muted'}
        hint={totals.overdue > 0 ? 'Promised earlier and missed' : 'Nothing is late'}
        help="Open leads whose promised call-back date has already passed."
      />
      <MetricCard
        label="Due today"
        value={totals.today}
        tone="accent"
        hint={totals.today > 0 ? 'Before the day ends' : 'Nothing owed today'}
        help="Open leads you promised to contact today."
      />
      <MetricCard
        label="Never contacted"
        value={totals.uncontacted}
        tone={totals.uncontacted > 0 ? 'warning' : 'muted'}
        hint={pct(totals.uncontacted)}
        help="Leads still marked new that nobody has rung, messaged or emailed."
      />
      <MetricCard
        label="Won this month"
        value={totals.wonThisMonth}
        tone="success"
        hint={`${totals.total} open · ${totals.hot} hot`}
        help="Leads converted to a client or project since the 1st."
      />
    </div>
  )
}
