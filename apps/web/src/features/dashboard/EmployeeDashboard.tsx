import { Link } from '@tanstack/react-router'
import { CalendarCheck2, CalendarDays, CheckCircle2, ClipboardList, MapPin } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { hoursLabel } from '@/features/shoots/assign'
import { localDay } from '@/features/booking/booking-model'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Button } from '@/shared/ui/button'
import { useMyTasks, useBoard } from '@/features/tasks/api'
import { useSlots } from '@/features/allocation/api'
import { useReminders } from '@/features/reminders/api'
import { useQuery } from '@tanstack/react-query'
import { attendanceRecord } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { MyDeliveryStrip } from '@/features/projects/MyDeliveryStrip'

const myList = attendanceRecord.array()

/**
 * The employee's own attendance. The path was `/hr/my`, which the API has
 * never served — the route is `/hr/attendance/my` — so this 404'd on every
 * load of the employee dashboard.
 */
function useMyAttendanceToday() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'my-attendance'],
    queryFn: () => callApi('/hr/attendance/my', { responseSchema: myList }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

/**
 * Lovable parity (EmployeeDashboard): the employee's own day — my_tasks /
 * shoots / attendance / schedule widgets via useMyTasks / useBoard / useSlots,
 * plus checked_in summary, reminders and quick links. Built from existing
 * hooks (no new endpoints) so it works for any role scoped to "mine".
 */
export function EmployeeDashboard() {
  const { session } = useAuth()
  const myTasks = useMyTasks()
  const board = useBoard()
  const slots = useSlots()
  const reminders = useReminders()
  const attendance = useMyAttendanceToday()

  const tasks = myTasks.data ?? board.data?.slice(0, 10) ?? []
  const openTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
  const today = new Date().toISOString().slice(0, 10)
  const dueToday = openTasks.filter((t) => t.due_date === today)
  const overdue = openTasks.filter((t) => t.due_date && t.due_date < today)

  // My own upcoming bookings, soonest first. (The API already sends only
  // yours to a team member; the filter keeps it right for a manager too.)
  const now = new Date().toISOString()
  const myUpcoming = (slots.data ?? [])
    .filter((s) => s.user_id === session?.user_id && s.status === 'booked' && s.end_at >= now)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
  const mySlots = myUpcoming.slice(0, 5)
  const todaySlots = myUpcoming.filter((s) => localDay(s.start_at) === localDay(now))
  const reminderItems = Array.isArray(reminders.data) ? reminders.data : (reminders.data?.items ?? [])
  const openReminders = reminderItems.filter((r) => r.status !== 'completed' && r.status !== 'dismissed').slice(0, 5)
  const todayAttendance = (attendance.data ?? []).find((a) => String(a.a_date ?? '').slice(0, 10) === today)
  /**
   * Derived from today's row rather than from a `/hr/checked-in` endpoint that
   * does not exist. That call 404'd and was caught into `{ checked_in: false }`,
   * so someone who had checked in was told they had not — every time, with no
   * error to notice.
   */
  const isCheckedIn = !!todayAttendance?.check_in_at && !todayAttendance?.check_out_at

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={ClipboardList} label="My open tasks" value={String(openTasks.length)} to="/tasks/my" />
        <Tile icon={CalendarCheck2} label="Due today" value={String(dueToday.length)} to="/tasks/my" />
        <Tile icon={CalendarDays} label="My shoots" value={String(mySlots.length)} to="/shoots/my" />
        <Tile
          icon={CheckCircle2}
          label="Attendance"
          value={isCheckedIn ? 'Checked in' : (todayAttendance ? String(todayAttendance.status ?? 'Marked') : 'Not in')}
          to="/attendance"
        />
      </div>

      <MyDeliveryStrip />

      {overdue.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-4 text-sm">
            <span className="font-medium">{overdue.length} overdue task{overdue.length === 1 ? '' : 's'}</span>
            <span className="text-muted-foreground"> — clear these first.</span>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>My tasks</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/tasks/my">All my tasks</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {myTasks.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : openTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open tasks assigned to you.</p>
            ) : (
              <ul className="divide-y divide-border">
                {openTasks.slice(0, 5).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.project_name ?? '—'}
                        {t.due_date ? ` · due ${t.due_date}` : ''}
                      </p>
                    </div>
                    <StatusBadge tone={t.due_date && t.due_date < today ? 'danger' : 'neutral'}>
                      {t.status.replace('_', ' ')}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>My shoots &amp; schedule</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/shoots/my">All my shoots</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {slots.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : mySlots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shoots scheduled.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {mySlots.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-sm">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="font-medium">{s.shoot_name ?? s.service_name ?? 'Booked'}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {new Date(s.start_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · {hoursLabel(s)}
                        {s.service_name && s.shoot_name ? ` · ${s.service_name}` : ''}
                        {s.location ? ` · ${s.location}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {todaySlots.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">{todaySlots.length} today.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>My attendance</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/attendance">Open</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="font-medium">{isCheckedIn ? 'Checked in' : 'Not checked in'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Today</p>
                <p className="font-medium">{todayAttendance ? String(todayAttendance.status ?? 'Marked') : '—'}</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Welcome{session?.display_name ? `, ${session.display_name}` : ''} — check in from the
              Attendance page when you reach the studio.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Reminders</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/reminders">All reminders</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {openReminders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reminders due right now.</p>
            ) : (
              <ul className="divide-y divide-border">
                {openReminders.map((r) => (
                  <li key={r.id} className="py-2 text-sm">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.due_at ? new Date(r.due_at).toLocaleDateString('en-IN') : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-sm font-medium">Quick links</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><Link to="/tasks/my">My tasks</Link></Button>
            <Button variant="outline" size="sm" asChild><Link to="/shoots/my">My shoots</Link></Button>
            <Button variant="outline" size="sm" asChild><Link to="/attendance">Attendance</Link></Button>
            <Button variant="outline" size="sm" asChild><Link to="/my-work">My work</Link></Button>
            <Button variant="outline" size="sm" asChild><Link to="/reminders">Reminders</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Tile({ icon: Icon, label, value, to }: { icon: typeof CheckCircle2; label: string; value: string; to: string }) {
  return (
    <Card>
      <Link to={to} className="block">
        <CardContent className="flex items-start gap-3 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold tabular-nums leading-tight">{value}</p>
            <p className="truncate text-sm text-muted-foreground">{label}</p>
          </div>
        </CardContent>
      </Link>
    </Card>
  )
}
