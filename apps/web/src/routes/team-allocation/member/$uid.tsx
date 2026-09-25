import { useMemo } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, CalendarPlus, Download, MapPin, Phone } from 'lucide-react'
import type { TeamSlot } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { MetricCard } from '@/shared/ui/metric-card'
import { RowMenu } from '@/shared/ui/row-menu'
import { SkeletonList } from '@/shared/ui/skeleton'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { formatINR, humanize } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { useAccess } from '@/shared/auth/useAccess'
import { useMembers, useSlots } from '@/features/allocation/api'
import { hoursLabel } from '@/features/shoots/assign'
import { hoursOf, todayLocal } from '@/features/booking/booking-model'
import { downloadIcs } from '@/features/booking/share'
import { useSlotActions } from '@/features/booking/useSlotActions'

/**
 * One person's bookings: what is coming up, what this month adds up to, and
 * the history -- each by shoot name, with a calendar file for what is next.
 */
export function AllocationMemberPage() {
  return (
    <AuthedPage module="projects">
      <MemberSchedule />
    </AuthedPage>
  )
}

const STATUS_TONE: Record<TeamSlot['status'], string> = {
  booked: 'bg-tone-green-soft text-tone-green',
  released: 'bg-tone-amber-soft text-tone-amber',
  cancelled: 'bg-muted text-muted-foreground line-through',
}

function MemberSchedule() {
  const { uid } = useParams({ from: '/authed/team-allocation/member/$uid' })
  const canPlan = useAccess().hasAction('projects', 'edit')
  const slots = useSlots({ user_id: uid })
  const members = useMembers()
  const actions = useSlotActions({ canPlan, members: members.data ?? [] })
  const member = (members.data ?? []).find((m) => m.user_id === uid)

  const now = new Date().toISOString()
  const month = todayLocal().slice(0, 7)
  const all = useMemo(() => [...(slots.data ?? [])].filter((s) => s.user_id === uid), [slots.data, uid])
  const upcoming = all.filter((s) => s.status === 'booked' && s.end_at >= now).sort((a, b) => a.start_at.localeCompare(b.start_at))
  const history = all.filter((s) => !(s.status === 'booked' && s.end_at >= now)).sort((a, b) => b.start_at.localeCompare(a.start_at))
  const thisMonth = all.filter((s) => s.status === 'booked' && s.start_at.slice(0, 7) === month)
  const hours = Math.round(thisMonth.reduce((n, s) => n + hoursOf(s), 0) * 10) / 10
  const name = member?.name ?? all[0]?.user_name ?? 'Team member'

  function exportCsv() {
    const t = (iso: string) => new Date(iso).toLocaleString('en-IN')
    downloadCsv(
      `schedule-${name.replace(/\W+/g, '-').toLowerCase()}.csv`,
      toCsv(
        ['Start', 'End', 'Shoot', 'Project', 'Role', 'Location', 'Status', ...(canPlan ? ['Payout'] : [])],
        all.map((s) => [t(s.start_at), t(s.end_at), s.shoot_name, s.project_name, s.service_name, s.location, s.status, ...(canPlan ? [s.final_cost ?? s.estimated_cost] : [])]),
      ),
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link to="/team-allocation">
          <ArrowLeft /> Team Booking
        </Link>
      </Button>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground">
            {member?.role_names.length ? member.role_names.join(', ') : member ? humanize(member.role) : ''}
          </p>
          {member?.phone && (
            <a href={`tel:${member.phone}`} className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline">
              <Phone className="size-3.5" aria-hidden /> {member.phone}
            </a>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!all.length}>
          <Download /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Coming up" value={upcoming.length} hint="booked, not yet done" />
        <MetricCard label="This month" value={thisMonth.length} hint="bookings" />
        <MetricCard label="Hours this month" value={hours} hint="booked time" />
        <MetricCard label="Released" value={all.filter((s) => s.status === 'released').length} tone="muted" hint="let go after booking" />
      </div>

      {slots.isLoading ? (
        <SkeletonList rows={5} columns={4} />
      ) : (
        <>
          <List title="Coming up" empty="Nothing booked ahead." items={upcoming} canPlan={canPlan} menuFor={actions.menuFor} showIcs />
          <List title="History" empty="No past or released bookings." items={history} canPlan={canPlan} menuFor={actions.menuFor} />
        </>
      )}
      {actions.dialogs}
    </section>
  )
}

function List({
  title,
  empty,
  items,
  canPlan,
  menuFor,
  showIcs = false,
}: {
  title: string
  empty: string
  items: TeamSlot[]
  canPlan: boolean
  menuFor: ReturnType<typeof useSlotActions>['menuFor']
  showIcs?: boolean
}) {
  return (
    <div>
      <h2 className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((s) => {
            const pay = s.final_cost ?? s.estimated_cost
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-4 py-3">
                <div className="w-28 shrink-0 text-sm">
                  <p className="font-semibold">{new Date(s.start_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{hoursLabel(s)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {s.shoot_id ? (
                      <Link to="/shoots/$shootId" params={{ shootId: s.shoot_id }} className="hover:text-primary hover:underline">
                        {s.shoot_name ?? 'Shoot'}
                      </Link>
                    ) : (
                      s.service_name ?? 'Blocked time'
                    )}
                    {s.shoot_id && s.service_name && <span className="font-normal text-muted-foreground"> · {s.service_name}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[s.project_name, s.client_name].filter(Boolean).join(' · ')}
                    {s.location && (
                      <span className="ml-1 inline-flex items-center gap-0.5">
                        <MapPin className="size-3" aria-hidden /> {s.location}
                      </span>
                    )}
                  </p>
                </div>
                {canPlan && pay != null && s.cost_status !== 'not_decided' && (
                  <span className="text-sm tabular-nums text-muted-foreground">{formatINR(pay)}</span>
                )}
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_TONE[s.status])}>{humanize(s.status)}</span>
                {showIcs && (
                  <Button variant="outline" size="sm" onClick={() => downloadIcs(s)}>
                    <CalendarPlus /> Add to calendar
                  </Button>
                )}
                {menuFor(s).length > 0 && <RowMenu label={`More for ${s.shoot_name ?? 'this booking'}`} items={menuFor(s)} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
