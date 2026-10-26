import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Flag, MessageCircle, Search, SlidersHorizontal, Tag, User } from 'lucide-react'
import type { CrmActivity } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Segmented } from '@/shared/ui/segmented'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { MultiSelectFilter, type FilterOption } from '@/shared/ui/multi-select-filter'
import { toneVar } from '@/shared/ui/tones'
import { cn } from '@/shared/ui/cn'
import { useAuth } from '@/shared/auth/AuthProvider'
import { CallButton } from '@/features/crm-calls/CallButton'
import { useActivities } from '@/features/crm/api'
import { FollowUpActions, FollowUpTag } from '@/features/crm/FollowUpOnRow'
import { useLookupOptions } from '@/features/crm/fields'
import { useAddLookupWord } from '@/features/settings/quick-words'
import {
  BOARD_COLUMNS,
  NONE,
  NO_FILTERS,
  activeFilterCount,
  boardColumns,
  boardSentence,
  filterFollowUps,
  peopleOn,
  type BoardColumnKey,
  type BoardFilters,
} from '@/features/crm/follow-up-board'

export function FollowUpBoardPage() {
  return (
    <AuthedPage module="crm">
      <FollowUpBoard />
    </AuthedPage>
  )
}

const SEES_ALL = new Set(['super_admin', 'admin', 'manager', 'platform_admin'])

const waLink = (phone: string) => {
  const d = phone.replace(/\D/g, '')
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`
}

/** Overdue reads red (a promise broken), today amber (the next thing), the rest calm. */
const HEAD: Partial<Record<BoardColumnKey, string>> = {
  overdue: 'border-tone-rose/50 bg-tone-rose-soft text-tone-rose',
  today: 'border-tone-amber/50 bg-tone-amber-soft text-tone-amber',
}

/**
 * The follow-up board (owner, 25 Oct): every promise made to a family, in
 * columns by when it is owed -- Overdue, Today, Tomorrow, This week, Later --
 * each card with the person, the time, the type and the note, and Call,
 * WhatsApp, Tomorrow and Done right on it. Mine by default; whoever runs the
 * studio can see Everyone's and narrow by person, type and priority.
 */
function FollowUpBoard() {
  const { session } = useAuth()
  const canSeeAll = SEES_ALL.has(session?.role ?? '')
  const [scope, setScope] = useState<'mine' | 'all'>(canSeeAll ? 'all' : 'mine')
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const q = useActivities({ openTasks: true, mine: scope === 'mine', live: true, limit: 1000 })
  const now = useMemo(() => new Date(), [q.dataUpdatedAt])
  const all = q.data ?? []
  const shown = useMemo(() => filterFollowUps(all, filters), [all, filters])
  const cols = useMemo(() => boardColumns(shown, now), [shown, now])
  const on = activeFilterCount(filters)
  const visible = BOARD_COLUMNS.filter((c) => c.key !== 'undated' || cols.undated.length > 0)

  return (
    <>
      <Link to="/follow-ups" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Leads
      </Link>
      <PageHeader title="Follow-ups" description={q.isPending ? undefined : boardSentence(cols)} />

      <div className="sticky top-0 z-20 -mx-1 mb-3 flex flex-wrap items-center gap-2 border-b border-border bg-background px-1 pb-3 pt-1">
        {canSeeAll && (
          <Segmented
            label="Whose follow-ups"
            value={scope}
            onChange={(v) => {
              setScope(v)
              setFilters((f) => ({ ...f, people: [] }))
            }}
            options={[
              { value: 'all', label: 'Everyone' },
              { value: 'mine', label: 'Mine' },
            ]}
          />
        )}
        <span className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search name, phone, note…"
            aria-label="Search follow-ups"
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
          {on - (filters.search.trim() ? 1 : 0) > 0 && (
            <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[0.65rem] font-semibold text-primary-foreground tabular-nums">
              {on - (filters.search.trim() ? 1 : 0)}
            </span>
          )}
        </Button>
        {showFilters && <Filters tasks={all} scope={scope} value={filters} onChange={setFilters} />}
      </div>

      {q.isPending ? (
        <SkeletonCards count={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            title="No follow-ups waiting"
            description="Set one from a lead's Next follow-up, and it shows here with its time."
            action={
              <Button variant="outline" asChild>
                <Link to="/follow-ups">Open leads</Link>
              </Button>
            }
          />
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing matches"
            action={
              <Button variant="outline" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4 lg:grid lg:auto-cols-[minmax(14rem,1fr)] lg:grid-flow-col lg:items-start lg:overflow-x-auto lg:pb-2">
          {visible.map((c) => (
            <section key={c.key} aria-label={c.label} className="flex min-w-0 flex-col gap-2">
              <h2
                className={cn(
                  'flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-bold',
                  HEAD[c.key] ?? 'border-border bg-muted/60',
                )}
              >
                {c.label}
                <span className="rounded-full bg-card/80 px-2 text-xs tabular-nums text-foreground">{cols[c.key].length}</span>
              </h2>
              {cols[c.key].length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Nothing here.</p>
              ) : (
                cols[c.key].map((t) => <FollowUpCardOnBoard key={t.id} task={t} showWho={scope === 'all'} />)
              )}
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function FollowUpCardOnBoard({ task: t, showWho }: { task: CrmActivity; showWho: boolean }) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <Link
          to="/follow-ups"
          search={{ lead: t.lead_id } as never}
          className="min-w-0 flex-1 truncate font-semibold hover:underline"
        >
          {t.lead_name ?? 'Lead'}
        </Link>
        {showWho && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium">
            <User className="size-3" aria-hidden /> {t.whose_name ?? 'Nobody'}
          </span>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <FollowUpTag task={t} />
      </p>
      {t.body && <p className="line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{t.body}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {t.lead_id && t.lead_phone && <CallButton lead={{ id: t.lead_id, phone: t.lead_phone, name: t.lead_name }} />}
        {t.lead_phone && (
          <Button size="sm" variant="outline" asChild>
            <a href={waLink(t.lead_phone)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${t.lead_name ?? 'them'}`}>
              <MessageCircle />
            </a>
          </Button>
        )}
        <span className="ml-auto flex gap-1.5">
          <FollowUpActions task={t} />
        </span>
      </div>
    </article>
  )
}

/** Person, type and priority: shown only once Filter is pressed. */
function Filters({
  tasks,
  scope,
  value,
  onChange,
}: {
  tasks: readonly CrmActivity[]
  scope: 'mine' | 'all'
  value: BoardFilters
  onChange: (f: BoardFilters) => void
}) {
  const types = useLookupOptions('follow_up_type')
  const priorities = useLookupOptions('follow_up_priority')
  const addType = useAddLookupWord('follow_up_type')
  const addPriority = useAddLookupWord('follow_up_priority')

  const count = (pick: (t: CrmActivity) => string | null) => {
    const m = new Map<string, number>()
    for (const t of tasks) {
      const k = (pick(t) ?? NONE).toLowerCase()
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }
  const typeCounts = count((t) => t.subject)
  const priorityCounts = count((t) => t.priority)
  const withSeen = (list: typeof types, counts: Map<string, number>): FilterOption[] => {
    const out: FilterOption[] = list.map((o) => ({
      value: o.value,
      label: o.label,
      color: o.color ? toneVar(o.color) : undefined,
      count: counts.get(o.value.toLowerCase()) ?? 0,
    }))
    return out
  }
  const set = (k: 'people' | 'types' | 'priorities') => (next: string[]) => onChange({ ...value, [k]: next })

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {scope === 'all' && (
        <MultiSelectFilter
          label="people"
          icon={User}
          options={peopleOn(tasks).map((p) => ({ value: p.id, label: p.name, count: p.count }))}
          selected={value.people}
          onChange={set('people')}
        />
      )}
      <MultiSelectFilter
        label="types"
        icon={Tag}
        options={withSeen(types, typeCounts)}
        selected={value.types}
        onChange={set('types')}
        onCreate={addType}
        noun="type"
      />
      <MultiSelectFilter
        label="priorities"
        icon={Flag}
        options={withSeen(priorities, priorityCounts)}
        selected={value.priorities}
        onChange={set('priorities')}
        onCreate={addPriority}
        noun="priority"
      />
      {activeFilterCount(value) > 0 && (
        <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => onChange({ ...value, people: [], types: [], priorities: [] })}>
          Clear filters
        </button>
      )}
    </div>
  )
}
