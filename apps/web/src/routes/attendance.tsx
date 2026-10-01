import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarDays, Clock } from 'lucide-react'
import { attendanceRecord } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { TodayAttendanceCard } from '@/features/attendance/TodayAttendanceCard'
import { TodayBoard } from '@/features/attendance/TodayBoard'
import { MonthRegister } from '@/features/attendance/MonthRegister'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { STATUS_LABEL, STATUS_TONE, formatTime } from '@/features/hr/attendance'

const myList = attendanceRecord.array()

type Tab = 'today' | 'month'

/**
 * Attendance, for whoever runs the studio: Today (where everyone is) and
 * Month (the muster roll, with its CSV). Everyone else sees their own record.
 * Checking in happens on the person's own card, not here.
 */
export function AttendancePage({ initialTab }: { initialTab?: Tab } = {}) {
  return (
    <AuthedPage module="attendance">
      <Attendance initialTab={initialTab} />
    </AuthedPage>
  )
}

function Attendance({ initialTab }: { initialTab?: Tab | undefined }) {
  const { session } = useAuth()
  const canSeeTeam = ['super_admin', 'admin', 'manager'].includes(session?.role ?? '')
  const [tab, setTab] = useState<Tab>(initialTab ?? 'today')
  if (!canSeeTeam) {
    return (
      <>
        <PageHeader title="Attendance" />
        <MyAttendance />
      </>
    )
  }
  return (
    <>
      <PageHeader title="Attendance" />
      <SectionTabs<Tab>
        tabs={[
          { value: 'today', label: 'Today' },
          { value: 'month', label: 'Month' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="mt-4">{tab === 'today' ? <TodayBoard /> : <MonthRegister />}</div>
    </>
  )
}

const HISTORY_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function MyAttendance() {
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

/**
 * /attendance/my: everyone's own record. The roster needs the attendance
 * module; your own day does not -- employees could never open this page, so
 * the dashboard's Attendance tile led to "Not available" (0206).
 */
export function MyAttendancePage() {
  return (
    <AuthedPage module="dashboard">
      <PageHeader title="My attendance" />
      <div className="flex flex-col gap-4">
        <TodayAttendanceCard />
        <MonthRegister mine />
        <p className="text-sm">
          A day wrong?{' '}
          <Link to="/leave" className="font-medium text-primary underline-offset-2 hover:underline">
            Ask to fix a day
          </Link>
        </p>
      </div>
    </AuthedPage>
  )
}
