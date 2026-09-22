import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, KeyRound, Power } from 'lucide-react'
import { toast } from 'sonner'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { useDirectory, useEmployeeRoles, useMonthlySalaries, useSendReset, useUpdateMember } from '@/features/team/api'
import { EditMemberDialog } from '@/features/team/EditMemberDialog'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const TYPE_TONE: Record<string, 'info' | 'warning' | 'neutral'> = {
  in_house: 'info',
  freelancer: 'warning',
}

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning'> = {
  active: 'success',
  inactive: 'neutral',
  pending: 'warning',
}

export function EmployeeDetailPage() {
  return (
    <AuthedPage module="team_directory">
      <EmployeeDetail />
    </AuthedPage>
  )
}

function EmployeeDetail() {
  const { id } = useParams({ from: '/authed/employees/$id' })
  const { session } = useAuth()
  const access = useAccess()
  const navigate = useNavigate()
  const { data: members, isLoading, isError, refetch } = useDirectory()
  const { data: roles } = useEmployeeRoles()
  const update = useUpdateMember()
  const reset = useSendReset()

  const member = (members ?? []).find((m) => m.user_id === id)
  const isSelf = session?.user_id === id
  const isEmployee = session?.role === 'employee'
  const canManage = !!session?.is_owner
  const showSalary = access.hasModule('team_salaries')

  // Salary history for this person (current year). Falls back to the
  // directory's current figure when the ledger has no rows for them.
  const now = new Date()
  const { data: ledger } = useMonthlySalaries({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    user_id: id,
  })
  const history = (ledger?.items ?? []).filter((s) => s.user_id === id)

  if (isLoading) return <SkeletonList rows={5} columns={2} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (!member) {
    return (
      <Card className="mt-6">
        <CardContent className="py-4">
          <EmptyState
            title="Team member not found"
            description="They may have been removed, or this link is for another studio."
            action={
              <Button variant="outline" onClick={() => navigate({ to: '/employees' })}>
                Back to team
              </Button>
            }
          />
        </CardContent>
      </Card>
    )
  }

  // Employees may only view themselves; managers+ see everyone.
  if (isEmployee && !isSelf) {
    return (
      <Card className="mt-6">
        <CardContent className="py-16 text-center">
          <p className="font-medium">Not your profile</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            You can only view your own team profile.
          </p>
        </CardContent>
      </Card>
    )
  }

  const active = member.status === 'active'
  const roleNames =
    member.role_names.length > 0
      ? member.role_names
      : (roles ?? []).filter((r) => member.role_ids.includes(r.id)).map((r) => r.type_name)

  const totalPaid = history.reduce((n, s) => n + s.paid_amount, 0)
  const totalBase = history.reduce((n, s) => n + s.base_amount, 0)

  function onToggleStatus() {
    update.mutate(
      { userId: member!.user_id, patch: { status: active ? 'inactive' : 'active' } },
      { onSuccess: () => toast.success(active ? 'Member deactivated.' : 'Member activated.') },
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/employees' })}>
          <ArrowLeft className="mr-1 size-4" /> Back
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {canManage && <EditMemberDialog member={member} />}
          {canManage && member.login_enabled && member.email && (
            <Button
              variant="outline"
              size="sm"
              disabled={reset.isPending}
              onClick={() =>
                reset.mutate(member.user_id, {
                  onSuccess: () => toast.success(`Reset link sent to ${member.name}.`),
                })
              }
            >
              <KeyRound className="mr-2 size-4" /> Send reset
            </Button>
          )}
          {canManage && member.role !== 'super_admin' && (
            <Button variant="outline" size="sm" disabled={update.isPending} onClick={onToggleStatus}>
              <Power className="mr-2 size-4" /> {active ? 'Deactivate' : 'Activate'}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{member.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge tone={TYPE_TONE[member.engagement_type ?? ''] ?? 'neutral'}>
                  {member.engagement_type === 'freelancer' ? 'Freelancer' : 'In-house'}
                </StatusBadge>
                <StatusBadge tone={STATUS_TONE[member.status] ?? 'neutral'}>
                  {humanize(member.status)}
                </StatusBadge>
                {!member.login_enabled && <StatusBadge>No login</StatusBadge>}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Joined {member.created_at.slice(0, 10)}
            </div>
          </div>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <Row label="Email" value={member.email ?? '—'} />
            <Row label="Phone" value={member.phone ?? '—'} />
            <Row label="Alternate phone" value={member.alternate_phone ?? '—'} />
            <Row
              label="Pay"
              value={
                !showSalary
                  ? '—'
                  : [
                      member.salary !== null ? `Salary ${formatINR(member.salary)}` : null,
                      member.freelancer_rate !== null ? `Rate ${formatINR(member.freelancer_rate)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'
              }
            />
            <Row label="Address" value={member.address ?? '—'} className="sm:col-span-2" />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-4">
          <h3 className="mb-3 font-medium">Role assignments</h3>
          {roleNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {roleNames.map((name) => (
                <span
                  key={name}
                  className="whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-xs"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No job roles assigned yet.</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Access level: {humanize(member.role)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">Salary summary</h3>
            {canManage && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/employees">Manage salaries</Link>
              </Button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <Stat label="Current base" value={member.salary !== null && showSalary ? formatINR(member.salary) : '—'} />
              <Stat label="Current rate" value={member.freelancer_rate !== null && showSalary ? formatINR(member.freelancer_rate) : '—'} />
              <Stat label="Status" value={humanize(member.payment_status)} />
            </div>
          ) : (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <Stat label="Current base" value={member.salary !== null && showSalary ? formatINR(member.salary) : '—'} />
                <Stat label="Total paid (history)" value={formatINR(totalPaid)} />
                <Stat label="Total pending" value={formatINR(Math.max(0, totalBase - totalPaid))} />
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2">Period</th>
                      <th>Base</th>
                      <th>Paid</th>
                      <th>Pending</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((s) => (
                      <tr key={s.id} className="border-t border-border">
                        <td className="py-2">
                          {MONTHS[s.month - 1]} {s.year}
                        </td>
                        <td>{formatINR(s.base_amount)}</td>
                        <td>{formatINR(s.paid_amount)}</td>
                        <td>{formatINR(Math.max(0, s.base_amount - s.paid_amount))}</td>
                        <td>{humanize(s.status.replace('_', ' '))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
