import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { BarChart3, CalendarClock, KanbanSquare, List, PhoneCall, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Segmented } from '@/shared/ui/segmented'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { SEARCH_MIN, useLeadSearch, useLeads, useSavedViews } from '@/features/crm/api'
import { AddLeadDialog } from '@/features/crm/AddLeadDialog'
import { LeadDrawer } from '@/features/crm/LeadDrawer'
import { GettingStarted } from '@/features/crm/GettingStarted'
import { ViewPicker, type ViewChoice } from '@/features/crm/ViewPicker'
import { inView, openingView, viewName } from '@/features/crm/builtin-views'
import { toLeadQuery } from '@/features/crm/views'
import { EMPTY_QUERY, applyQuery, countsFor, isOpen, type LeadQuery } from '@/features/crm/leads'
import { InboxTab } from '@/features/crm/tabs/InboxTab'
import { FollowUpBoardTab, PipelineTab } from '@/features/crm/tabs/BoardTabs'

/**
 * One list, and nothing above it but a header and a line of controls.
 *
 * This page used to open with a tab bar, two full-width filter bars, a
 * five-item checklist and four counter cards -- eight blocks before the first
 * lead, on the screen a studio opens every morning to find out who to ring.
 *
 * Every one of those counters was really the size of a list, so the number
 * moved into the name of the view you would click to see it, and the view
 * picker replaced the tabs. What is left is: who you owe a call, in order.
 *
 * Nothing was removed from the product. The stage board is a view; the
 * configuration screens are on /follow-ups/setup; the numbers are in the
 * picker; everything else is a keystroke away on the command palette.
 */
export function FollowUpsPage() {
  return (
    <AuthedPage module="crm">
      <Crm />
    </AuthedPage>
  )
}

function Crm() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const [view, setView] = useState<ViewChoice | null>(null)
  const [query, setQuery] = useState<LeadQuery>(EMPTY_QUERY)
  const [text, setText] = useState('')
  const [openLead, setOpenLead] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  /*
   * Every filter this page ever had is still here -- status, owner, quality,
   * group, the seven chips, saved-view management, columns, density, archived,
   * CSV. It is off until asked for, which is the whole point: the filters were
   * two full-width bars above the list a studio reads every morning.
   */
  const [showFilters, setShowFilters] = useState(false)

  /**
   * How the chosen leads are drawn: as a list, bucketed by when they are due,
   * or as the stage board. Separate from WHICH leads, so "Hot leads, on the
   * board" is now a thing that can be asked for.
   */
  const [mode, setMode] = useState<'list' | 'board' | 'pipeline'>('list')

  // A ?lead= link (a reminder, a converted enquiry, an alert) opens straight
  // to that lead -- even an archived one -- then clears itself so closing the
  // panel and reloading does not reopen it.
  const linkedLeadId = (search as { lead?: unknown }).lead
  const hasLeadLink = typeof linkedLeadId === 'string' && linkedLeadId.length > 0
  useEffect(() => {
    if (!hasLeadLink) return
    setOpenLead(linkedLeadId as string)
    void navigate({ to: '/follow-ups', search: {} as never, replace: true })
  }, [hasLeadLink]) // fires once, off the initial URL

  const active = useLeads(false)
  const everything = useLeads(showArchived || hasLeadLink)
  const { data: savedViews } = useSavedViews()
  const allOpen = useMemo(() => active.data ?? [], [active.data])
  const allLeads = useMemo(() => everything.data ?? [], [everything.data])

  // One clock for the page, so a lead cannot be "due today" in the picker and
  // "overdue" in the list because two components asked at different moments.
  const now = useMemo(() => new Date(), [active.data])

  // Which view to land on is a question about the data, so it can only be
  // answered once the data is here -- and only once, or every refetch would
  // drag someone back to Today while they were reading something else.
  const landing = openingView(allOpen, now)
  useEffect(() => {
    if (view === null && !active.isLoading) setView({ kind: 'builtin', key: landing })
  }, [view, active.isLoading, landing])

  const current: ViewChoice = view ?? { kind: 'builtin', key: 'today' }
  const saved = savedViews ?? []

  const label =
    current.kind === 'saved'
      ? (saved.find((v) => v.id === current.id)?.name ?? 'Saved view')
      : viewName(current.key)

  /** The rows this view is, before the search box narrows them further. */
  const inViewRows = useMemo(() => {
    const source = showArchived ? allLeads : allOpen
    // The board and the stage board both want open leads only -- a won deal has
    // no next call and no stage to sit in.
    if (mode !== 'list') {
      const open = source.filter(isOpen)
      if (current.kind === 'saved') {
        const v = saved.find((x) => x.id === current.id)
        return v ? applyQuery(open, toLeadQuery(v.query), now) : open
      }
      return inView(open, current.key, now)
    }
    if (current.kind === 'saved') {
      const v = saved.find((x) => x.id === current.id)
      return v ? applyQuery(source, toLeadQuery(v.query), now) : source.filter(isOpen)
    }
    return inView(source, current.key, now)
  }, [current, mode, allOpen, allLeads, showArchived, saved, now])

  // A quarter of a second of quiet before we ask the server, so typing a phone
  // number is one request and not eleven.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 250)
    return () => clearTimeout(t)
  }, [text])

  const searching = debounced.trim().length >= SEARCH_MIN
  const found = useLeadSearch(debounced)

  /** The same match the server makes, for the rows already in hand. */
  const clientMatch = useMemo(() => {
    const needle = text.trim().toLowerCase()
    if (!needle) return inViewRows
    return inViewRows.filter((l) =>
      [l.name, l.phone, l.email, l.notes, l.assignee_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    )
  }, [inViewRows, text])

  // While the request is in flight the local matches stand in, so the list
  // never blinks empty between keystrokes. Once it lands, the server's answer
  // wins -- it is the one that has seen every lead.
  const rows = searching && found.data ? found.data : clientMatch

  const chipCounts = useMemo(() => countsFor(allOpen, now), [allOpen, now])
  const selected =
    [...(found.data ?? []), ...allLeads, ...allOpen].find((l) => l.id === openLead) ?? null
  const isEmptyStudio = !active.isLoading && allOpen.length === 0 && !searching

  return (
    <>
      <PageHeader
        title="Leads"
        description="Everyone who got in touch, and who you owe a call."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/follow-ups/queue">
                <PhoneCall /> Today's calls
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/follow-ups/reports">
                <BarChart3 /> Reports
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/follow-ups/setup">
                <Settings2 /> Setup
              </Link>
            </Button>
            <AddLeadDialog onAdded={(id) => setOpenLead(id)} />
          </div>
        }
      />

      {/*
        * One toolbar, in the order the questions get asked: how do I want to
        * see them, which ones, find one, narrow it.
        *
        * Sticky, because on a board that scrolls sideways and a list four
        * hundred rows long, the controls scrolling away means scrolling back up
        * to change anything.
        */}
      <div className="sticky top-0 z-20 -mx-1 mt-2 flex flex-wrap items-center gap-2 border-b border-border bg-background px-1 pb-3 pt-1">
        <Segmented
          label="How to show these leads"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'list', label: 'List', icon: List },
            { value: 'board', label: 'Board', icon: CalendarClock },
            { value: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
          ]}
        />
        <ViewPicker leads={allOpen} now={now} value={current} onChange={setView} saved={saved} label={label} />
        <span className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search leads…"
            aria-label="Search leads"
            className="pl-8"
          />
        </span>
        <Button
          variant={showFilters ? 'default' : 'outline'}
          size="sm"
          shape="square"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal /> Filter
        </Button>
      </div>

      {/* Search deliberately ignores the chosen view and the archive, because
          "where did that person go" is the question being asked. Saying so
          matters: the result set is not the list the picker describes. */}
      {searching && (
        <p className="mt-2 text-sm text-muted-foreground">
          {found.isPending
            ? 'Searching every lead…'
            : `${rows.length === 200 ? 'First 200' : rows.length} of all your leads, archived included, matching “${debounced.trim()}”`}{' '}
          <button type="button" className="underline hover:no-underline" onClick={() => setText('')}>
            Back to {label}
          </button>
        </p>
      )}

      <div className="mt-4">
        {active.isLoading ? (
          <SkeletonList rows={5} columns={4} />
        ) : active.isError ? (
          <ErrorState error={active.error} onRetry={() => void active.refetch()} />
        ) : isEmptyStudio ? (
          /* The checklist a studio needs once, on the only screen where it is
             the most useful thing present: an empty one. */
          <GettingStarted leads={allOpen} />
        ) : mode === 'pipeline' ? (
          <PipelineTab leads={rows} onOpen={setOpenLead} />
        ) : mode === 'board' ? (
          <FollowUpBoardTab leads={rows} now={now} onOpen={setOpenLead} />
        ) : (
          <InboxTab
            chrome={showFilters}
            leads={rows}
            now={now}
            query={query}
            onQuery={setQuery}
            counts={chipCounts}
            onOpen={setOpenLead}
            showArchived={showArchived}
            onShowArchived={setShowArchived}
          />
        )}
      </div>

      {selected && <LeadDrawer lead={selected} onClose={() => setOpenLead(null)} />}
    </>
  )
}
