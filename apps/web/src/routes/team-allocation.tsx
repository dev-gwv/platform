import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, ChevronLeft, ChevronRight, Download, Search, UserPlus, X } from 'lucide-react'
import { shootListItem, type ShootListItem } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { MetricCard } from '@/shared/ui/metric-card'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { cn } from '@/shared/ui/cn'
import { useMembers, useSlots } from '@/features/allocation/api'
import { AssignTeamDialog } from '@/features/shoots/AssignTeamDialog'
import { BulkAssignDialog } from '@/features/shoots/BulkAssignDialog'
import { conflictItems, figures, monthDays, shiftMonth, staffing, todayLocal } from '@/features/booking/booking-model'
import { ShootCard } from '@/features/booking/ShootCard'
import { PeopleGrid } from '@/features/booking/PeopleGrid'
import { ConflictsView } from '@/features/booking/ConflictsView'
import { BlockTimeDialog } from '@/features/booking/BlockTimeDialog'
import { useSlotActions } from '@/features/booking/useSlotActions'

type View = 'shoots' | 'people' | 'conflicts'

export function TeamAllocationPage({ initialTab }: { initialTab?: 'calendar' | 'conflicts' } = {}) {
  return (
    <AuthedPage module="projects">
      <TeamBooking initialView={initialTab === 'conflicts' ? 'conflicts' : 'shoots'} />
    </AuthedPage>
  )
}

const shootsList = shootListItem.array()

/**
 * Team Booking: a month of shoots and who is on each one, role by role; the
 * whole team's month at a glance; and what needs fixing. Every Assign button
 * opens the same Assign Team dialog the project page uses.
 */
function TeamBooking({ initialView }: { initialView: View }) {
  const { session } = useAuth()
  const access = useAccess()
  const canPlan = access.hasAction('projects', 'edit')

  const [viewParam, setView] = useUrlParam('view', initialView)
  const [monthParam, setMonth] = useUrlParam('month', todayLocal().slice(0, 7))
  const [focus, setFocus] = useUrlParam('focus')
  const [q, setQ] = useUrlParam('q')
  const view: View = viewParam === 'people' || viewParam === 'conflicts' ? viewParam : 'shoots'
  const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : todayLocal().slice(0, 7)
  const days = monthDays(month)
  const from = days[0]!
  const to = days[days.length - 1]!

  const slots = useSlots({ from, to })
  const members = useMembers()
  const shoots = useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: shootsList }),
    enabled: !!session,
  })

  const [assign, setAssign] = useState<{ shoot: ShootListItem; role?: string | undefined } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const actions = useSlotActions({ canPlan, members: members.data ?? [] })

  const monthSlots = useMemo(() => (slots.data ?? []).filter((s) => s.status !== 'cancelled'), [slots.data])
  const inMonth = useMemo(
    () =>
      (shoots.data ?? [])
        .filter((s) => s.shoot_date && s.shoot_date >= from && s.shoot_date <= to && s.status !== 'cancelled')
        .sort((a, b) => (a.shoot_date ?? '').localeCompare(b.shoot_date ?? '') || (a.start_at ?? '').localeCompare(b.start_at ?? '')),
    [shoots.data, from, to],
  )
  const conflicts = useMemo(() => conflictItems(monthSlots), [monthSlots])
  const f = figures(inMonth, monthSlots, conflicts.length)

  const needle = q.trim().toLowerCase()
  const shown = inMonth.filter((s) => {
    if (focus === 'short') {
      const st = staffing(s, monthSlots).state
      if (st !== 'empty' && st !== 'partial') return false
    }
    if (!needle) return true
    const crew = monthSlots.filter((x) => x.shoot_id === s.id).map((x) => x.user_name ?? '')
    return `${s.name} ${s.project_name ?? ''} ${s.client_name ?? ''} ${s.location ?? ''} ${crew.join(' ')}`.toLowerCase().includes(needle)
  })
  const byDay = useMemo(() => {
    const m = new Map<string, ShootListItem[]>()
    for (const s of shown) m.set(s.shoot_date!, [...(m.get(s.shoot_date!) ?? []), s])
    return [...m.entries()]
  }, [shown])

  const monthLabel = new Date(`${from}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  function exportCsv() {
    const head = ['Date', 'Start', 'End', 'Person', 'Role', 'Shoot', 'Project', 'Client', 'Location', 'Status', ...(canPlan ? ['Payout', 'Payout status'] : [])]
    const t = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    const rows = monthSlots.map((s) => [
      new Date(s.start_at).toLocaleDateString('en-CA'),
      t(s.start_at),
      t(s.end_at),
      s.user_name,
      s.service_name,
      s.shoot_name,
      s.project_name,
      s.client_name,
      s.location,
      s.status,
      ...(canPlan ? [s.final_cost ?? s.estimated_cost, s.cost_status] : []),
    ])
    downloadCsv(`team-booking-${month}.csv`, toCsv(head, rows))
  }

  const loading = shoots.isLoading || slots.isLoading
  const failed = shoots.isError || slots.isError

  return (
    <>
      <PageHeader
        title="Team Booking"
        description="Book your team for upcoming shoots and avoid double-booking."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!monthSlots.length}>
              <Download /> Export CSV
            </Button>
            {canPlan && (
              <>
                <Button variant="outline" size="sm" onClick={() => setBlockOpen(true)}>
                  <CalendarClock /> Block time
                </Button>
                <Button size="sm" onClick={() => setBulkOpen(true)}>
                  <UserPlus /> Bulk assign
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Shoots" value={f.shoots} hint={monthLabel} />
        <FigureButton active={focus === 'short'} onClick={() => { setView('shoots'); setFocus(focus === 'short' ? '' : 'short') }}>
          <MetricCard
            label="Roles to fill"
            value={f.toFill}
            tone={f.toFill > 0 ? 'danger' : 'success'}
            hint={f.needed ? `${f.filled} of ${f.needed} booked · ${f.shortShoots} shoot${f.shortShoots === 1 ? '' : 's'} short` : 'no roles planned'}
            help="Seats the month's shoots still need. Tap to see only the short-staffed shoots."
            className="h-full"
          />
        </FigureButton>
        <MetricCard label="People booked" value={f.people} hint={`of ${(members.data ?? []).length} in the team`} />
        <FigureButton active={view === 'conflicts'} onClick={() => setView(view === 'conflicts' ? 'shoots' : 'conflicts')}>
          <MetricCard
            label="Conflicts"
            value={f.conflicts}
            tone={conflicts.some((c) => c.severity === 'critical') ? 'danger' : f.conflicts ? 'warning' : 'muted'}
            hint={f.conflicts ? 'tap to fix' : 'all clear'}
            className="h-full"
          />
        </FigureButton>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterTabs<View>
          value={view}
          onChange={setView}
          tabs={[
            { value: 'shoots', label: 'Shoots', count: inMonth.length },
            { value: 'people', label: 'People' },
            { value: 'conflicts', label: 'Conflicts', count: conflicts.length },
          ]}
        />
        <div className="flex items-center rounded-lg border border-border bg-card">
          <Button variant="ghost" size="icon" className="size-9" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-32 text-center text-sm font-semibold" aria-live="polite">
            {monthLabel}
          </span>
          <Button variant="ghost" size="icon" className="size-9" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setMonth(todayLocal().slice(0, 7))}>
          Today
        </Button>
        {view !== 'conflicts' && (
          <label className="relative w-full sm:ml-auto sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={view === 'people' ? 'Search people or shoots…' : 'Search shoot, client, person…'} aria-label="Search" className="pl-9" />
          </label>
        )}
        {focus === 'short' && view === 'shoots' && (
          <Button variant="ghost" size="sm" onClick={() => setFocus('')}>
            <X /> Short-staffed only
          </Button>
        )}
      </div>

      <div className="mt-4">
        {loading ? (
          <SkeletonCards count={3} />
        ) : failed ? (
          <ErrorState message="We could not load the bookings." onRetry={() => { void shoots.refetch(); void slots.refetch() }} />
        ) : view === 'people' ? (
          <PeopleGrid month={month} members={members.data ?? []} slots={monthSlots} q={q} menuFor={actions.menuFor} />
        ) : view === 'conflicts' ? (
          <ConflictsView items={conflicts} canPlan={canPlan} menuFor={actions.menuFor} onFix={actions.edit} />
        ) : byDay.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="font-semibold">{inMonth.length ? 'Nothing matches' : `No shoots in ${monthLabel}`}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {inMonth.length ? 'Try a different search, or clear the filter.' : 'Shoots added to projects show here, with their roles to fill.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {byDay.map(([day, list]) => (
              <section key={day} aria-label={dayHeading(day)}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  {dayHeading(day)}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {list.length} shoot{list.length === 1 ? '' : 's'}
                  </span>
                </h2>
                <div className="flex flex-col gap-3">
                  {list.map((s) => (
                    <ShootCard
                      key={s.id}
                      shoot={s}
                      slots={monthSlots}
                      canPlan={canPlan}
                      menuFor={actions.menuFor}
                      onAssign={(shoot, role) => setAssign({ shoot, role })}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {actions.dialogs}
      {assign && (
        <AssignTeamDialog key={assign.shoot.id} shoot={assign.shoot} initialRequirement={assign.role} onClose={() => setAssign(null)} />
      )}
      {bulkOpen && <BulkAssignDialog onClose={() => setBulkOpen(false)} />}
      {blockOpen && <BlockTimeDialog onClose={() => setBlockOpen(false)} />}
    </>
  )
}

function dayHeading(day: string) {
  const d = new Date(`${day}T00:00:00`)
  const label = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  const today = todayLocal()
  const tomorrow = shiftDay(today, 1)
  return day === today ? `Today · ${label}` : day === tomorrow ? `Tomorrow · ${label}` : label
}

function shiftDay(day: string, by: number) {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + by)
  return d.toLocaleDateString('en-CA')
}

function FigureButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-full rounded-xl text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'ring-2 ring-primary' : 'hover:-translate-y-0.5',
      )}
    >
      {children}
    </button>
  )
}
