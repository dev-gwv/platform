import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CalendarDays,
  Clock,
  Download,
  LogIn,
  LogOut,
  MapPin,
  Pencil,
  RefreshCw,
  Flame,
} from 'lucide-react'
import {
  attendanceDayRow,
  attendanceRecord,
  attendanceStatus,
  companyFence,
  setAttendanceRequest,
  setFenceRequest,
  z,
  type AttendanceDayRow,
  type CheckInRequest,
  type SetAttendanceRequest,
  type SetFenceRequest,
} from '@ipc/contracts'
import { withinFence } from '@ipc/domain'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { Avatar } from '@/shared/ui/avatar'
import { CountUp } from '@/shared/ui/count-up'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import {
  EMPTY_FILTERS,
  STATUS_LABEL,
  STATUS_TONE,
  displayStatus,
  lateBy,
  formatTime,
  hasFilters,
  hoursWorked,
  summarise,
  toCsv,
  todayISO,
  type AttendanceFilters,
  type DisplayStatus,
} from '@/features/hr/attendance'

const myList = attendanceRecord.array()
const dayList = attendanceDayRow.array()
const idOnly = z.object({ id: z.string() })

type Tab = 'dashboard' | 'mine'

export function AttendancePage({ initialTab }: { initialTab?: Tab } = {}) {
  return (
    <AuthedPage module="attendance">
      <Attendance initialTab={initialTab} />
    </AuthedPage>
  )
}

function useFence() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'location'],
    queryFn: () => callApi('/hr/location', { responseSchema: companyFence.nullable() }),
    enabled: !!session,
    staleTime: 300_000,
  })
}

function useAttendanceStreak() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'attendance', 'streak'],
    queryFn: () =>
      callApi('/hr/attendance/streak', {
        responseSchema: z.object({ streak: z.number().int(), last_check_date: z.string().nullable() }),
      }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

function Attendance({ initialTab }: { initialTab?: Tab | undefined }) {
  const { session } = useAuth()
  const { data: streak } = useAttendanceStreak()
  // Everyone can see their own record; only the people who run the studio have
  // a roster to look at, so employees land straight on their own history.
  const canSeeTeam = ['super_admin', 'admin', 'manager'].includes(session?.role ?? '')
  const [tab, setTab] = useState<Tab>(initialTab ?? (canSeeTeam ? 'dashboard' : 'mine'))

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Track your team's daily check-ins, check-outs, and attendance status."
        actions={
          <div className="flex items-center gap-3">
            {streak && streak.streak > 0 && (
              <div className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
                <Flame className="h-4 w-4" />
                {streak.streak} day streak
              </div>
            )}
            <ClockActions />
          </div>
        }
      />

      {canSeeTeam && (
        <SectionTabs<Tab>
          tabs={[
            { value: 'dashboard', label: 'Dashboard' },
            { value: 'mine', label: 'My attendance' },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}

      {tab === 'dashboard' && canSeeTeam ? <TeamDashboard /> : <MyAttendance />}
    </>
  )
}

/** Check in and out. The fence is checked here and again on the server. */
function ClockActions() {
  const qc = useQueryClient()
  const { data: fence } = useFence()

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['attendance'] })
    void qc.invalidateQueries({ queryKey: ['hr', 'attendance'] })
  }

  const checkIn = useMutation({
    mutationFn: (input: CheckInRequest) =>
      callApi('/hr/check-in', { method: 'POST', body: input, responseSchema: idOnly }),
    onSuccess: () => {
      toast.success('Checked in')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const checkOut = useMutation({
    mutationFn: () => callApi('/hr/check-out', { method: 'POST', responseSchema: idOnly }),
    onSuccess: () => {
      toast.success('Checked out')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function doCheckIn() {
    const send = (lat: number, lng: number) => {
      // A local check saves a doomed round trip and gives a clearer reason; the
      // server still refuses anything outside the fence either way (when active).
      if (fence?.is_active && !withinFence({ lat, lng }, { lat: fence.lat, lng: fence.lng }, fence.radius_m)) {
        toast.error('You appear to be outside the studio fence.')
        return
      }
      checkIn.mutate({ lat, lng })
    }
    if (!navigator.geolocation) {
      toast.error('This browser cannot share your location, so check-in is unavailable.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => send(p.coords.latitude, p.coords.longitude),
      () => toast.error('Allow location access to check in.'),
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={() => checkOut.mutate()} disabled={checkOut.isPending}>
        <LogOut /> {checkOut.isPending ? 'Checking out…' : 'Check out'}
      </Button>
      <Button onClick={doCheckIn} disabled={checkIn.isPending}>
        <LogIn /> {checkIn.isPending ? 'Checking in…' : 'Check in'}
      </Button>
    </div>
  )
}

const pagedDay = z.object({
  items: dayList,
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
  /**
   * Counted server-side over the whole filtered roster. Older deploys do not
   * send it, so it stays optional and the page falls back to counting the
   * rows it has -- which is what it always did, and what was wrong.
   */
  summary: z
    .object({
      total: z.number().int(),
      present: z.number().int(),
      absent: z.number().int(),
      not_checked_out: z.number().int(),
      percent: z.number(),
    })
    .optional(),
})

function TeamDashboard() {
  const { session } = useAuth()
  const [date, setDate] = useState(todayISO())
  const [filters, setFilters] = useState<AttendanceFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const { data: fence } = useFence()

  // Server-paginated roster: search narrows on the server, the rest refines
  // the loaded page client-side. Falls back to the legacy array shape.
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['hr', 'attendance', date, page, pageSize, filters.search, filters.status, filters.type],
    queryFn: async () => {
      const qs = new URLSearchParams({ date, page: String(page), page_size: String(pageSize) })
      if (filters.search.trim()) qs.set('search', filters.search.trim())
      // Status and engagement used to narrow the page the browser already
      // had, while the count under it described the whole roster.
      if (filters.status !== 'all') qs.set('status', filters.status)
      if (filters.type) qs.set('type', filters.type)
      const raw: unknown = await callApi(`/hr/attendance?${qs.toString()}`, {
        responseSchema: z.unknown(),
      })
      const paged = pagedDay.safeParse(raw)
      if (paged.success) return paged.data
      const items = dayList.parse(raw)
      const start = (page - 1) * pageSize
      return { items: items.slice(start, start + pageSize), total: items.length, page, page_size: pageSize }
    },
    staleTime: 15_000,
  })

  const rows = useMemo(() => data?.items ?? [], [data])
  const total = data?.total ?? 0
  // The server returns the right rows for these filters, so there is nothing
  // left to narrow here; filtering again would only disagree with the count.
  const shown = rows
  // Counted over the whole filtered roster. Computing this from `rows` meant
  // a studio of forty read "Total 25" on page one of its own attendance.
  const totals = useMemo(
    () =>
      data?.summary
        ? {
            total: data.summary.total,
            present: data.summary.present,
            absent: data.summary.absent,
            notCheckedOut: data.summary.not_checked_out,
            percent: data.summary.percent,
          }
        : summarise(rows),
    [data, rows],
  )
  // Only the people who answer for the roster may rewrite a day on it.
  const canCorrect = !!session?.is_owner || session?.role === 'admin'

  function exportCsv() {
    const blob = new Blob([toCsv(shown)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <HowToUse
        title="Track attendance"
        description="See who checked in, who checked out, and who never arrived."
        steps={[
          'Set the attendance location first.',
          'Ask your team to check in from the studio.',
          'Review the day here.',
        ]}
      />

      {!fence && session?.is_owner && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
          <MapPin className="size-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-sm">
            No attendance location set. Until there is one, anybody can check in from anywhere.
          </p>
          <FenceDialog />
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Total" value={totals.total} />
        <Tile label="Present" value={totals.present} tone="success" />
        <Tile label="Absent" value={totals.absent} tone="danger" />
        <Tile label="Not checked out" value={totals.notCheckedOut} tone="info" />
        <Tile label="Attendance" value={`${totals.percent}%`} tone="neutral" />
      </div>

      <div className="mt-4 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label>Search</Label>
          <Input
            value={filters.search}
            onChange={(e) => {
              setFilters({ ...filters, search: e.target.value })
              setPage(1)
            }}
            placeholder="Name, email or phone"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select
            value={filters.status}
            onChange={(e) =>
              setFilters({ ...filters, status: e.target.value as AttendanceFilters['status'] })
            }
          >
            <option value="all">All</option>
            {(['present', 'late', 'absent', 'not_checked_out'] as DisplayStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Select
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          >
            <option value="">All</option>
            <option value="in_house">In-house</option>
            <option value="freelancer">Freelancer</option>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={cn(isFetching && 'animate-spin')} /> Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={shown.length === 0}>
          <Download /> CSV
        </Button>
        {hasFilters(filters) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          Showing {shown.length} of {total} · page {page}
        </span>
        <Select
          value={String(pageSize)}
          onChange={(e) => {
            setPageSize(Number(e.target.value))
            setPage(1)
          }}
          aria-label="Page size"
          className="h-8 w-24"
        >
          <option value="10">10 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page * pageSize >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonList rows={5} columns={5} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : shown.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                title={
                  rows.length === 0
                    ? 'No attendance records found for this date.'
                    : 'Nobody matches these filters.'
                }
                description={
                  rows.length === 0
                    ? 'Try a different date, or ask your team to check in.'
                    : 'Clear a filter to widen the list.'
                }
              />
            </CardContent>
          </Card>
        ) : (
          <RosterTable rows={shown} date={date} canCorrect={canCorrect} />
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Absent means no check-in was recorded for the date.
        {canCorrect
          ? ' Use Correct on a row to fix a missed or wrong check-in; corrections are recorded in the audit log.'
          : ''}
      </p>
    </>
  )
}

function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  tone?: 'success' | 'danger' | 'info' | 'neutral'
}) {
  const toneClass = {
    success: 'text-success',
    danger: 'text-destructive',
    info: 'text-primary',
    neutral: 'text-foreground',
  }[tone]
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-xl font-semibold tabular-nums', toneClass)}>
          {typeof value === 'number' ? <CountUp value={value} /> : value}
        </p>
      </CardContent>
    </Card>
  )
}

function RosterTable({
  rows,
  date,
  canCorrect,
}: {
  rows: readonly AttendanceDayRow[]
  date: string
  canCorrect: boolean
}) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const status = displayStatus(r)
          return (
            <div key={r.user_id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate font-medium">
                  <Link to="/employees/$id" params={{ id: r.user_id }} className="hover:underline">
                    {r.name}
                  </Link>
                </p>
                <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
                {lateBy(r) && <span className="text-xs text-warning">{lateBy(r)}</span>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                In {formatTime(r.check_in_at)} · Out {formatTime(r.check_out_at)}
              </p>
              {r.corrected_by && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Corrected{r.correction_note ? ` · ${r.correction_note}` : ''}
                </p>
              )}
              {canCorrect && (
                <div className="mt-2">
                  <CorrectDialog row={r} date={date} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="table-wrap rounded-lg border border-border">
      <table className="table-sticky w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="min-w-48 px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Checked in</th>
            <th className="px-4 py-2 font-medium">Checked out</th>
            <th className="px-4 py-2 text-right font-medium">Hours</th>
            {canCorrect && <th className="px-4 py-2"></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = displayStatus(r)
            const hours = hoursWorked(r)
            return (
              <tr key={r.user_id} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2 font-medium">
                    <Avatar name={r.name} size="sm" />
                    <Link to="/employees/$id" params={{ id: r.user_id }} className="hover:underline">
                      {r.name}
                    </Link>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.engagement_type === 'freelancer' ? 'Freelancer' : 'In-house'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
                  {lateBy(r) && <span className="ml-2 text-xs text-warning">{lateBy(r)}</span>}
                  {r.corrected_by && (
                    <span className="ml-2 text-xs text-muted-foreground" title={r.correction_note ?? undefined}>
                      corrected
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{formatTime(r.check_in_at)}</td>
                <td className="px-4 py-2 text-muted-foreground">{formatTime(r.check_out_at)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{hours === null ? '—' : hours}</td>
                {canCorrect && (
                  <td className="px-4 py-2 text-right">
                    <span className="row-actions">
                      <CorrectDialog row={r} date={date} />
                    </span>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const HISTORY_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function MyAttendance() {
  const { session } = useAuth()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['attendance', 'my', month, year],
    queryFn: () =>
      callApi(`/hr/attendance/my?month=${month}&year=${year}`, { responseSchema: myList }),
    enabled: !!session,
    staleTime: 15_000,
  })

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid max-w-xl gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Month</Label>
          <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
            {HISTORY_MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>{m}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Year</Label>
          <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState
              title="No attendance this month"
              description="Check in to start your record, or pick another month."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
                <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">{a.a_date}</span>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="size-3.5" />
                  in {formatTime(a.check_in_at)} · out {formatTime(a.check_out_at)}
                </span>
                <StatusBadge
                  className="ml-auto"
                  tone={STATUS_TONE[a.check_in_at && !a.check_out_at ? 'not_checked_out' : a.status]}
                >
                  {STATUS_LABEL[a.check_in_at && !a.check_out_at ? 'not_checked_out' : a.status]}
                </StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/** Owner-only: pin the studio, so check-in can be refused from anywhere else. */
function FenceDialog() {
  const qc = useQueryClient()
  const { data: fence } = useFence()
  const [open, setOpen] = useState(false)
  const [lat, setLat] = useState(String(fence?.lat ?? ''))
  const [lng, setLng] = useState(String(fence?.lng ?? ''))
  const [radius, setRadius] = useState(String(fence?.radius_m ?? 150))
  const [enforce, setEnforce] = useState(fence?.is_active ?? true)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (input: SetFenceRequest) =>
      callApi('/hr/location', { method: 'PATCH', body: input, responseSchema: companyFence }),
    onSuccess: () => {
      toast.success('Attendance location saved')
      void qc.invalidateQueries({ queryKey: ['hr', 'location'] })
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('This browser cannot share a location.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(String(p.coords.latitude))
        setLng(String(p.coords.longitude))
        setError(null)
      },
      () => setError('Allow location access, or type the coordinates in.'),
    )
  }

  function onSave() {
    const parsed = setFenceRequest.safeParse({
      lat: Number(lat),
      lng: Number(lng),
      radius_m: Number(radius),
      timezone: fence?.timezone ?? 'Asia/Kolkata',
      is_active: enforce,
      // Saving the circle must not wipe the start-of-day rules set elsewhere.
      expected_checkin_time: fence?.expected_checkin_time ?? null,
      late_grace_minutes: fence?.late_grace_minutes ?? 15,
      missed_cutoff_time: fence?.missed_cutoff_time ?? null,
    })
    if (!parsed.success) {
      setError('Check the coordinates and a radius between 20 and 5000 metres.')
      return
    }
    save.mutate(parsed.data)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <MapPin /> Set location
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Attendance location"
        description="Check-ins are refused from outside this circle."
      >
        <div className="flex flex-col gap-3">
          <Button variant="outline" onClick={useMyLocation}>
            <MapPin /> Use my current location
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Latitude</Label>
              <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="19.0760" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Longitude</Label>
              <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="72.8777" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Radius (metres)</Label>
            <Input value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="150" />
            <p className="text-xs text-muted-foreground">
              Between 20 and 5000. Too tight and GPS drift alone locks people out.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
            Enforce this location on check-in
          </label>
          {!enforce && (
            <p className="text-xs text-muted-foreground">
              Check-in still works from anywhere while this is off — useful for a shoot day away from the studio,
              or while re-measuring the location. It stays saved for when you turn it back on.
            </p>
          )}
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save location'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A datetime-local value from an ISO string, in the viewer's own timezone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Owner or admin rewriting one person's day: a missed tap, a check-in from the
 * wrong side of the fence, a shift that never got closed. Replaces the row for
 * that date, records who corrected it and why, and lands in the audit log.
 */
function CorrectDialog({ row, date }: { row: AttendanceDayRow; date: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<SetAttendanceRequest['status']>(row.status)
  const [checkIn, setCheckIn] = useState(toLocalInput(row.check_in_at))
  const [checkOut, setCheckOut] = useState(toLocalInput(row.check_out_at))
  const [note, setNote] = useState(row.correction_note ?? '')
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `attendance-correct:${row.user_id}:${date}` : null,
    { status, checkIn, checkOut, note },
    (v) => {
      setStatus(v.status)
      setCheckIn(v.checkIn)
      setCheckOut(v.checkOut)
      setNote(v.note)
    },
  )

  const save = useMutation({
    mutationFn: (input: SetAttendanceRequest) =>
      callApi(`/hr/attendance/${row.user_id}/${date}`, { method: 'PUT', body: input, responseSchema: idOnly }),
    onSuccess: () => {
      draft.clear()
      toast.success(`Attendance corrected for ${row.name}`)
      void qc.invalidateQueries({ queryKey: ['hr', 'attendance'] })
      setOpen(false)
    },
    onError: (e: Error) => setError(e.message),
  })

  function onSave() {
    setError(null)
    const parsed = setAttendanceRequest.safeParse({
      status,
      check_in_at: checkIn ? new Date(checkIn).toISOString() : null,
      check_out_at: checkOut ? new Date(checkOut).toISOString() : null,
      ...(note.trim() ? { note: note.trim() } : {}),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the times.')
      return
    }
    save.mutate(parsed.data)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setStatus(row.status)
          setCheckIn(toLocalInput(row.check_in_at))
          setCheckOut(toLocalInput(row.check_out_at))
          setNote(row.correction_note ?? '')
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Pencil /> Correct
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Correct ${row.name}`}
        description={`${date} · the row for this date is replaced with what you enter.`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="corr-status">Status</Label>
            <Select
              id="corr-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as SetAttendanceRequest['status'])}
            >
              {attendanceStatus.options.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corr-in">Checked in</Label>
              <Input id="corr-in" type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corr-out">Checked out</Label>
              <Input id="corr-out" type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="corr-note">Why</Label>
            <Input
              id="corr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Forgot to tap in; confirmed with the shoot lead"
            />
          </div>
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save correction'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
