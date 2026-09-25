import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, CalendarDays, Check, FileText, KeyRound, Lock, Mail, MapPin, Phone, Power } from 'lucide-react'
import { toast } from 'sonner'
import { ID_DOCUMENT_LABEL, PROFILE_FIELD_LABEL, type MemberOverview, type ProfileField } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { useAuth } from '@/shared/auth/AuthProvider'
import { ApiError } from '@/shared/api/client'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { MetricCard } from '@/shared/ui/metric-card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { useDirectory, useMemberOverview, useSendReset, useUpdateMember } from '@/features/team/api'
import { EditMemberDialog } from '@/features/team/EditMemberDialog'
import { openIdDocument, useIdDocuments } from '@/features/profile/api'

/**
 * One team member, seen from every side: who they are and how complete their
 * profile is, the work on their plate, this month's attendance and leave, and
 * what they have been paid. The member can open their own page; anyone with
 * the Team Directory can open anyone's. The server trims every section for
 * whoever is asking, so the page shows what comes back and nothing else.
 */
export function EmployeeDetailPage() {
  return (
    <AuthedPage module="dashboard">
      <MemberPage />
    </AuthedPage>
  )
}

type Tab = 'overview' | 'work' | 'attendance' | 'pay'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LEAVE_TONE = { pending: 'warning', approved: 'success' } as const

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
// Shoot and clock times in India time, whatever the device is set to.
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null
const hm = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`)

function MemberPage() {
  const { id } = useParams({ from: '/authed/employees/$id' })
  const { session } = useAuth()
  const navigate = useNavigate()
  const q = useMemberOverview(id)
  const [tab, setTab] = useUrlParam('tab', 'overview')
  const isSelf = session?.user_id === id

  if (q.isLoading) return <SkeletonList rows={6} columns={2} />
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404)) {
    return (
      <Card className="mt-6">
        <CardContent className="py-4">
          <EmptyState
            title={q.error.status === 403 ? 'Not your profile' : 'Team member not found'}
            description={
              q.error.status === 403
                ? 'You can open your own page. Other team members are for whoever runs the team.'
                : 'They may have been removed, or this link is for another studio.'
            }
            action={
              <Button variant="outline" onClick={() => navigate({ to: isSelf ? '/profile' : '/employees' })}>
                {isSelf ? 'My profile' : 'Back to team'}
              </Button>
            }
          />
        </CardContent>
      </Card>
    )
  }
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />

  const o = q.data
  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    ...(o.work ? [{ value: 'work' as Tab, label: 'Work' }] : []),
    ...(o.attendance || o.leave ? [{ value: 'attendance' as Tab, label: 'Attendance' }] : []),
    ...(o.salaries || o.payouts ? [{ value: 'pay' as Tab, label: 'Pay' }] : []),
  ]
  const current = (tabs.some((t) => t.value === tab) ? tab : 'overview') as Tab

  return (
    <section className="flex flex-col gap-4">
      <Header o={o} isSelf={isSelf} />
      <SectionTabs tabs={tabs} value={current} onChange={(v) => setTab(v)} variant="underline" label="Member sections" />
      {current === 'overview' && <OverviewTab o={o} isSelf={isSelf} onOpen={(t) => setTab(t)} />}
      {current === 'work' && o.work && <WorkTab work={o.work} memberId={o.member.user_id} />}
      {current === 'attendance' && <AttendanceTab o={o} isSelf={isSelf} />}
      {current === 'pay' && <PayTab o={o} />}
    </section>
  )
}

// ── Header: who, and what can be done about them ────────────────────────
function Header({ o, isSelf }: { o: MemberOverview; isSelf: boolean }) {
  const navigate = useNavigate()
  const m = o.member
  const directory = useDirectory()
  const row = (directory.data ?? []).find((d) => d.user_id === m.user_id)
  const update = useUpdateMember()
  const reset = useSendReset()
  const active = m.status === 'active'
  const canEdit = o.can.edit && !m.is_owner

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate({ to: isSelf && !o.can.edit ? '/dashboard' : '/employees' })}>
            <ArrowLeft className="size-4" /> Back
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            {isSelf && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/profile">Edit my profile</Link>
              </Button>
            )}
            {canEdit && row && <EditMemberDialog member={row} />}
            {canEdit && m.login_enabled && m.email && (
              <Button
                variant="outline"
                size="sm"
                disabled={reset.isPending}
                onClick={() => reset.mutate(m.user_id, { onSuccess: () => toast.success(`Reset link sent to ${m.name}.`) })}
              >
                <KeyRound className="size-4" /> Send reset
              </Button>
            )}
            {canEdit && m.role !== 'super_admin' && !isSelf && (
              <Button
                variant="outline"
                size="sm"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate(
                    { userId: m.user_id, patch: { status: active ? 'inactive' : 'active' } },
                    { onSuccess: () => toast.success(active ? 'Member deactivated.' : 'Member activated.') },
                  )
                }
              >
                <Power className="size-4" /> {active ? 'Deactivate' : 'Activate'}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4">
          <Avatar name={m.name} src={m.avatar_url} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{m.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {m.is_owner && <StatusBadge tone="info">Owner</StatusBadge>}
              <StatusBadge tone={m.engagement_type === 'freelancer' ? 'warning' : 'info'}>
                {m.engagement_type === 'freelancer' ? 'Freelancer' : 'In-house'}
              </StatusBadge>
              <StatusBadge tone={active ? 'success' : 'neutral'}>{humanize(m.status)}</StatusBadge>
              {!m.login_enabled && <StatusBadge>No login</StatusBadge>}
              <span className="text-xs text-muted-foreground">Access: {humanize(m.role)}</span>
            </div>
            {m.role_names.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.role_names.map((r) => (
                  <span key={r} className="whitespace-nowrap rounded-full border border-border px-2.5 py-0.5 text-xs">
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Completeness o={o} isSelf={isSelf} />
        </div>
      </CardContent>
    </Card>
  )
}

function Completeness({ o, isSelf }: { o: MemberOverview; isSelf: boolean }) {
  const { percent, missing } = o.profile
  const done = percent === 100
  return (
    <div className="w-full sm:w-64">
      <p className={cn('text-sm font-medium', done && 'text-success')}>
        {done ? (
          <span className="inline-flex items-center gap-1">
            <Check className="size-4" /> Profile complete
          </span>
        ) : (
          `Profile ${percent}% complete`
        )}
      </p>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', done ? 'bg-success' : 'bg-primary')} style={{ width: `${percent}%` }} />
      </div>
      {!done && (
        <p className="mt-1 text-xs text-muted-foreground">
          Missing: {missing.map((f) => PROFILE_FIELD_LABEL[f as ProfileField] ?? f).join(', ')}
          {isSelf && (
            <>
              {' · '}
              <Link to="/profile" className="font-medium text-primary underline-offset-2 hover:underline">
                Finish it
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────
function OverviewTab({ o, isSelf, onOpen }: { o: MemberOverview; isSelf: boolean; onOpen: (t: Tab) => void }) {
  const m = o.member
  const work = o.work
  const late = work ? work.deliverables.filter((d) => d.late).length + (work.tasks ?? []).filter((t) => t.late).length : 0
  const open = work ? work.deliverables.length + (work.tasks ?? []).length : 0
  const a = o.attendance

  return (
    <div className="flex flex-col gap-4">
      {(work || a) && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {work && (
            <button type="button" className="text-left" onClick={() => onOpen('work')}>
              <MetricCard label="Upcoming shoots" value={work.shoots.length} hint={`${work.shoots_this_month} booked this month`} />
            </button>
          )}
          {work && (
            <button type="button" className="text-left" onClick={() => onOpen('work')}>
              <MetricCard label="Open work" value={open} hint="deliverables and tasks" />
            </button>
          )}
          {work && (
            <button type="button" className="text-left" onClick={() => onOpen('work')}>
              <MetricCard label="Late" value={late} tone={late > 0 ? 'danger' : 'success'} hint={late > 0 ? 'past their due date' : 'nothing overdue'} />
            </button>
          )}
          {a && (
            <button type="button" className="text-left" onClick={() => onOpen('attendance')}>
              <MetricCard label="Days in this month" value={a.present + a.late} hint={a.late > 0 ? `${a.late} late · ${a.absent} absent` : `${a.absent} absent`} tone="muted" />
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold">Contact</h2>
            <dl className="mt-3 grid gap-3 text-sm">
              <Line icon={<Mail className="size-4" />} label="Email" value={m.email} />
              <Line icon={<Phone className="size-4" />} label="Phone" value={[m.phone, m.alternate_phone].filter(Boolean).join(' · ') || null} />
              <Line icon={<MapPin className="size-4" />} label="Address" value={m.address} />
              <Line icon={<CalendarDays className="size-4" />} label="With the studio since" value={day((o.private?.joined_on ?? m.created_at).slice(0, 10))} />
            </dl>
          </CardContent>
        </Card>
        {o.private && <PrivateCard p={o.private} isSelf={isSelf} userId={m.user_id} />}
      </div>
    </div>
  )
}

function PrivateCard({ p, isSelf, userId }: { p: NonNullable<MemberOverview['private']>; isSelf: boolean; userId: string }) {
  const docs = useIdDocuments(isSelf ? undefined : userId)
  const payTo = p.upi_id
    ? `UPI ${p.upi_id}`
    : p.bank_account_last4
      ? `Bank ••••${p.bank_account_last4}${p.bank_ifsc ? ` · ${p.bank_ifsc}` : ''}`
      : null
  const emergency = p.emergency_name ? [p.emergency_name, p.emergency_relation, p.emergency_phone].filter(Boolean).join(' · ') : null
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="flex items-center gap-1.5 font-semibold">
          Private
          <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <Lock className="size-3" aria-hidden /> {isSelf ? 'you and the owner' : 'you and the member'}
          </span>
        </h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Line label="Date of birth" value={p.date_of_birth ? day(p.date_of_birth) : null} />
          <Line label="Blood group" value={p.blood_group} />
          <Line label="Emergency contact" value={emergency} wide />
          <Line label="Pay to" value={payTo} />
          <Line label="PAN" value={p.pan_on_file ? 'On file' : null} />
        </dl>
        <div className="mt-3 border-t border-border pt-3 text-sm">
          <p className="text-xs text-muted-foreground">ID proof</p>
          {(docs.data ?? []).length === 0 ? (
            <p className="text-muted-foreground">{docs.isLoading ? '…' : 'Not added'}</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-2">
              {(docs.data ?? []).map((d) => (
                <li key={d.id}>
                  <Button variant="outline" size="sm" onClick={() => void openIdDocument(d.id, isSelf ? undefined : userId)}>
                    <FileText className="size-4" /> {ID_DOCUMENT_LABEL[d.kind]}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Line({ label, value, icon, wide }: { label: string; value: string | null; icon?: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('flex min-w-0 gap-2', wide && 'sm:col-span-2')}>
      {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className={cn('break-words', value ? 'font-medium' : 'text-muted-foreground')}>{value ?? 'Not added'}</dd>
      </div>
    </div>
  )
}

// ── Work ─────────────────────────────────────────────────────────────────
function WorkTab({ work, memberId }: { work: NonNullable<MemberOverview['work']>; memberId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Upcoming shoots</h2>
            <Link to="/team-allocation/member/$uid" params={{ uid: memberId }} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
              Full schedule
            </Link>
          </div>
          {work.shoots.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing booked ahead.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {work.shoots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
                  <span className="w-44 shrink-0 font-medium tabular-nums">{when(s.start_at)}</span>
                  <span className="min-w-0 flex-1">
                    {s.shoot_name ?? 'Shoot'}
                    {s.project_id && s.project_name && (
                      <>
                        {' · '}
                        <Link to="/projects/$id" params={{ id: s.project_id }} className="text-muted-foreground hover:underline">
                          {s.project_name}
                        </Link>
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{[s.service_name, s.location].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">Deliverables</h2>
          {work.deliverables.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No open deliverables.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {work.deliverables.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{d.title}</span>
                    {d.project_name && (
                      <>
                        {' · '}
                        <Link to="/projects/$id" params={{ id: d.project_id }} className="text-muted-foreground hover:underline">
                          {d.project_name}
                        </Link>
                      </>
                    )}
                  </span>
                  {d.started_at ? <StatusBadge tone="info">Started</StatusBadge> : <StatusBadge>Not started</StatusBadge>}
                  <Due date={d.estimated_date} late={d.late} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {work.tasks && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold">Tasks</h2>
            {work.tasks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No open tasks.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {work.tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{t.title}</span>
                      {t.project_name && <span className="text-muted-foreground"> · {t.project_name}</span>}
                    </span>
                    {(t.priority === 'high' || t.priority === 'urgent') && <StatusBadge tone="warning">{humanize(t.priority)}</StatusBadge>}
                    <Due date={t.due_date} late={t.late} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Due({ date, late }: { date: string | null; late: boolean }) {
  if (!date) return <span className="text-xs text-muted-foreground">No due date</span>
  return (
    <span className={cn('text-xs tabular-nums', late ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
      {late ? 'Late · was due ' : 'Due '}
      {shortDay(date)}
    </span>
  )
}

// ── Attendance and leave ────────────────────────────────────────────────
function AttendanceTab({ o, isSelf }: { o: MemberOverview; isSelf: boolean }) {
  const a = o.attendance
  const today = a?.today
  const monthName = a ? new Date(`${a.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long' }) : ''
  return (
    <div className="flex flex-col gap-4">
      {a && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="On time" value={a.present} tone="success" hint={`days in ${monthName}`} />
            <MetricCard label="Late" value={a.late} tone={a.late > 0 ? 'warning' : 'muted'} hint={a.late_minutes > 0 ? `${hm(a.late_minutes)} in all` : 'never late'} />
            <MetricCard label="Absent" value={a.absent} tone={a.absent > 0 ? 'danger' : 'muted'} hint="not on leave or a day off" />
            <MetricCard label="On leave" value={a.leave_days} tone="muted" hint="approved days" />
          </div>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <span className="font-semibold">Today</span>
              {today?.on_leave ? (
                <StatusBadge tone="info">On leave</StatusBadge>
              ) : today?.check_in_at ? (
                <span>
                  In at {time(today.check_in_at)}
                  {today.check_out_at ? `, out at ${time(today.check_out_at)}` : ' · still in'}
                  {today.status === 'late' && <StatusBadge tone="warning" className="ml-2">Late</StatusBadge>}
                </span>
              ) : (
                <span className="text-muted-foreground">Not checked in</span>
              )}
              <Link
                to={isSelf ? '/attendance/my' : '/attendance/$uid'}
                params={isSelf ? undefined : { uid: o.member.user_id }}
                className="ml-auto font-medium text-primary underline-offset-2 hover:underline"
              >
                Every day
              </Link>
            </CardContent>
          </Card>
        </>
      )}
      {o.leave && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Leave ahead</h2>
              <Link to="/leave" search={isSelf ? undefined : { tab: 'approvals' }} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                {isSelf ? 'Ask for leave' : 'Leave & holidays'}
              </Link>
            </div>
            {o.leave.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No leave coming up.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {o.leave.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="min-w-0 flex-1 font-medium">
                      {l.end_date > l.start_date ? `${shortDay(l.start_date)} – ${shortDay(l.end_date)}` : shortDay(l.start_date)}
                      {l.half_day && <span className="font-normal text-muted-foreground"> · half day</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{humanize(l.kind)}</span>
                    <StatusBadge tone={LEAVE_TONE[l.status as keyof typeof LEAVE_TONE] ?? 'neutral'}>{humanize(l.status)}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Pay ──────────────────────────────────────────────────────────────────
function PayTab({ o }: { o: MemberOverview }) {
  const m = o.member
  const salaries = o.salaries ?? []
  const payouts = o.payouts ?? []
  const paid = salaries.reduce((n, s) => n + s.paid_amount, 0) + payouts.filter((p) => p.status === 'completed').reduce((n, p) => n + p.amount, 0)
  const pending =
    salaries.reduce((n, s) => n + Math.max(0, s.base_amount - s.paid_amount), 0) +
    payouts.filter((p) => p.status === 'pending').reduce((n, p) => n + p.amount, 0)
  const basis = [m.salary !== null ? `${formatINR(m.salary)} a month` : null, m.freelancer_rate !== null ? `${formatINR(m.freelancer_rate)} a shoot` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard label="Pay" value={<span className="text-lg">{basis || 'Not set'}</span>} tone="muted" />
        <MetricCard label="Paid" value={formatINR(paid)} tone="success" hint="in the entries below" />
        <MetricCard label="Still to pay" value={formatINR(pending)} tone={pending > 0 ? 'warning' : 'muted'} />
      </div>

      {o.salaries && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold">Salary</h2>
            {salaries.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No salary months yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[26rem] text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">Month</th>
                      <th className="font-medium">Salary</th>
                      <th className="font-medium">Paid</th>
                      <th className="font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salaries.map((s) => (
                      <tr key={s.id} className="border-t border-border">
                        <td className="py-2">
                          {MONTHS[s.month - 1]} {s.year}
                        </td>
                        <td className="tabular-nums">{formatINR(s.base_amount)}</td>
                        <td className="tabular-nums">{formatINR(s.paid_amount)}</td>
                        <td>
                          <StatusBadge tone={s.status === 'paid' ? 'success' : s.paid_amount > 0 ? 'warning' : 'neutral'}>{humanize(s.status)}</StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {o.payouts && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold">Payouts</h2>
            {payouts.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No payouts yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {payouts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      {shortDay(p.period_start)} – {shortDay(p.period_end)}
                      {p.reference && <span className="text-xs text-muted-foreground"> · {p.payment_mode ? `${p.payment_mode} ` : ''}{p.reference}</span>}
                    </span>
                    <span className="font-medium tabular-nums">{formatINR(p.amount)}</span>
                    <StatusBadge tone={p.status === 'completed' ? 'success' : p.status === 'pending' ? 'warning' : 'neutral'}>{humanize(p.status)}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
