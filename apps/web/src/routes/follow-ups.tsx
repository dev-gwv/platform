import { useEffect, useMemo, useState } from 'react'
import { PanelBoundary } from '@/shared/layout/RouteError'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { BarChart3, CalendarClock, FileUp, KanbanSquare, List, PhoneCall, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { LeadLimitLine } from '@/features/billing/LeadLimitLine'
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
import { EMPTY_QUERY, applyQuery, countsFor, isOpen, isUncontacted, type LeadQuery } from '@/features/crm/leads'
import { InboxTab } from '@/features/crm/tabs/InboxTab'
import { FollowUpBoardTab, PipelineTab } from '@/features/crm/tabs/BoardTabs'
import { BoardFilters } from '@/features/crm/BoardFilters'
import { CsvImport } from '@/features/crm/tabs/ImportsTab'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { useAccess } from '@/shared/auth/useAccess'
import { NO_EXTRAS, NO_FACETS, activeExtrasCount, activeFacetCount, applyExtras, applyFacets, type LeadExtras, type LeadFacets } from '@/features/crm/board-filters'
import { DateField } from '@/shared/ui/date-field'
import { cn } from '@/shared/ui/cn'

const FACETS_KEY = 'crm:facets'
const EXTRAS_KEY = 'crm:extras'
type Mode = 'list' | 'board' | 'pipeline'

/** Read something this browser remembered; a private window just gets the default. */
function remembered<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback
  } catch {
    return fallback
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    /* private window: it still works, it just is not remembered */
  }
}

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
  // The facet filters (stage, event, quality, owner, tag, source) stay put
  // between visits: a studio that works "Weddings, hot" works it every day.
  const [facets, setFacetsState] = useState<LeadFacets>(() => remembered(FACETS_KEY, NO_FACETS))
  const setFacets = (f: LeadFacets) => {
    setFacetsState(f)
    remember(FACETS_KEY, f)
  }
  // Behind the Filter button: when the next call is due, event dates, when
  // they came in, budget, hot only, reached or not. Remembered the same way.
  const [extras, setExtrasState] = useState<LeadExtras>(() => remembered(EXTRAS_KEY, NO_EXTRAS))
  const setExtras = (x: LeadExtras) => {
    setExtrasState(x)
    remember(EXTRAS_KEY, x)
  }
  const extrasOn = activeExtrasCount(extras)
  const facetsOn = activeFacetCount(facets)

  /**
   * How the chosen leads are drawn: as a list, bucketed by when they are due,
   * or as the stage board. Separate from WHICH leads, so "Hot leads, on the
   * board" is now a thing that can be asked for.
   */
  // Leads always opens on the pipeline (owner, 10 Oct): a List or Board
  // picked here holds while you stay on the page, and the next visit starts
  // on the pipeline again. It used to be remembered, so one tap on List
  // meant never seeing the pipeline first again.
  const [mode, setMode] = useState<Mode>('pipeline')

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
  const notContacted = useMemo(() => allOpen.filter(isUncontacted).length, [allOpen])
  const allLeads = useMemo(() => everything.data ?? [], [everything.data])

  // One clock for the page, so a lead cannot be "due today" in the picker and
  // "overdue" in the list because two components asked at different moments.
  const now = useMemo(() => new Date(), [active.data])

  // Which view to land on is a question about the data, so it can only be
  // answered once the data is here -- and only once, or every refetch would
  // drag someone back to Today while they were reading something else.
  // The pipeline opens whole -- every open lead in its column. Only the list
  // lands on "who do I owe a call" (Today's calls is one tap away either way).
  const landing = mode === 'list' ? openingView(allOpen, now) : 'all'
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
  const unfaceted = searching && found.data ? found.data : clientMatch
  const rows = useMemo(() => applyExtras(applyFacets(unfaceted, facets), extras, now), [unfaceted, facets, extras, now])

  const chipCounts = useMemo(() => countsFor(allOpen, now), [allOpen, now])
  const selected =
    [...(found.data ?? []), ...allLeads, ...allOpen].find((l) => l.id === openLead) ?? null
  const isEmptyStudio = !active.isLoading && allOpen.length === 0 && !searching

  return (
    <>
      <PageHeader
        title="Leads"
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
            <ImportLeadsButton />
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
      <LeadLimitLine />
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
        {/* Who nobody has rung yet, counted the moment a lead lands. */}
        {notContacted > 0 && !(current.kind === 'builtin' && current.key === 'uncontacted') && (
          <button
            type="button"
            onClick={() => setView({ kind: 'builtin', key: 'uncontacted' })}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-tone-amber/60 bg-tone-amber-soft px-2.5 py-1 text-xs font-semibold text-tone-amber hover:border-tone-amber"
          >
            {notContacted} not contacted yet
          </button>
        )}
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
          {extrasOn + facetsOn + (showArchived ? 1 : 0) > 0 && (
            <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[0.65rem] font-semibold text-primary-foreground tabular-nums">
              {extrasOn + facetsOn + (showArchived ? 1 : 0)}
            </span>
          )}
        </Button>
      </div>

      {/* Filters stay hidden until Filter is pressed (the owner's rule); a
          filter already narrowing the list keeps its row in view, so a lead
          never seems to vanish for no reason. */}
      {!isEmptyStudio && (showFilters || facetsOn > 0) && (
        <div className="mt-3">
          <BoardFilters leads={unfaceted} value={facets} onChange={setFacets} />
        </div>
      )}

      {/* The Filter button used to open a second toolbar -- a banner, saved
          views, columns, seven chips, another search box and four more
          selects -- above leads that were already filtered by the row
          above. The owner found it tiring; this is all it holds now. */}
      {showFilters && (
        <MoreFilters
          value={extras}
          onChange={setExtras}
          showArchived={showArchived}
          onShowArchived={setShowArchived}
          onClearAll={() => {
            setFacets(NO_FACETS)
            setExtras(NO_EXTRAS)
            setShowArchived(false)
            setText('')
          }}
        />
      )}

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
            chrome={false}
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

      {selected && (
        <PanelBoundary resetKey={selected.id} label="this lead">
          <LeadDrawer lead={selected} onClose={() => setOpenLead(null)} />
        </PanelBoundary>
      )}
    </>
  )
}

/** A short either/or as pills you can see: one is always chosen. */
function Pills<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T | null
  onChange: (v: T | null) => void
  options: ReadonlyArray<{ value: T | null; label: string }>
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/50',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The filters behind the Filter button. Each is one short row: what it is,
 * then the choices. Nothing is on until picked.
 */
function MoreFilters({
  value,
  onChange,
  showArchived,
  onShowArchived,
  onClearAll,
}: {
  value: LeadExtras
  onChange: (x: LeadExtras) => void
  showArchived: boolean
  onShowArchived: (on: boolean) => void
  onClearAll: () => void
}) {
  const set = <K extends keyof LeadExtras>(k: K, v: LeadExtras[K]) => onChange({ ...value, [k]: v })
  const money = (v: string) => (v.trim() === '' ? null : Math.max(0, Number(v.replace(/[^\d]/g, '')) || 0))
  const row = 'grid items-center gap-2 sm:grid-cols-[8rem_1fr]'
  const name = 'text-xs font-semibold text-muted-foreground'
  return (
    <div className="mt-2 grid gap-3 rounded-lg border border-border bg-card p-3 text-sm lg:grid-cols-2">
      <div className={row}>
        <span className={name}>Next call</span>
        <Pills
          label="Next call"
          value={value.due}
          onChange={(v) => set('due', v)}
          options={[
            { value: null, label: 'Any' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'This week' },
            { value: 'none', label: 'Not set' },
          ]}
        />
      </div>
      <div className={row}>
        <span className={name}>Came in</span>
        <Pills
          label="Came in"
          value={value.addedDays}
          onChange={(v) => set('addedDays', v)}
          options={[
            { value: null, label: 'Any time' },
            { value: 1, label: 'Today' },
            { value: 7, label: 'Last 7 days' },
            { value: 30, label: 'Last 30 days' },
          ]}
        />
      </div>
      <div className={row}>
        <span className={name}>Event date</span>
        <div className="flex flex-wrap items-center gap-2">
          <DateField
            aria-label="Event from"
            placeholder="From"
            value={value.eventFrom ?? ''}
            onChange={(e) => set('eventFrom', e.target.value || null)}
            className="h-8 w-36"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <DateField
            aria-label="Event to"
            placeholder="To"
            value={value.eventTo ?? ''}
            onChange={(e) => set('eventTo', e.target.value || null)}
            className="h-8 w-36"
          />
        </div>
      </div>
      <div className={row}>
        <span className={name}>Budget (₹)</span>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            inputMode="numeric"
            aria-label="Budget from"
            placeholder="From"
            value={value.budgetMin ?? ''}
            onChange={(e) => set('budgetMin', money(e.target.value))}
            className="h-8 w-28"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            inputMode="numeric"
            aria-label="Budget to"
            placeholder="To"
            value={value.budgetMax ?? ''}
            onChange={(e) => set('budgetMax', money(e.target.value))}
            className="h-8 w-28"
          />
        </div>
      </div>
      <div className={row}>
        <span className={name}>Reached</span>
        <Pills
          label="Reached"
          value={value.contacted}
          onChange={(v) => set('contacted', v)}
          options={[
            { value: null, label: 'Any' },
            { value: 'never', label: 'Never contacted' },
            { value: 'yes', label: 'Contacted' },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.hotOnly} onChange={(e) => set('hotOnly', e.target.checked)} />
          Hot only
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchived(e.target.checked)} />
          Show archived
        </label>
        <button type="button" className="ml-auto text-sm font-medium text-primary hover:underline" onClick={onClearAll}>
          Clear all filters
        </button>
      </div>
    </div>
  )
}

/**
 * Import a spreadsheet of leads from the Leads page itself. It lived only
 * on Setup, where nobody looked for it; the owner could not find it at all.
 */
function ImportLeadsButton() {
  const canCreate = useAccess().hasAction('crm', 'create')
  if (!canCreate) return null
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUp /> Import leads
        </Button>
      </DialogTrigger>
      <DialogContent title="Import leads" description="Upload a CSV from Excel or Google Sheets. You see every row before anything is saved." className="sm:max-w-3xl">
        <CsvImport />
      </DialogContent>
    </Dialog>
  )
}
