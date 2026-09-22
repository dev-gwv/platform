import { KeyRound, Search, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { DirectoryMember, EmployeeRole } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR, humanize } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { Avatar } from '@/shared/ui/avatar'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { useRemoveMember, useSendReset, useUpdateMember } from './api'
import { EditMemberDialog } from './EditMemberDialog'
import type { DirectoryFilters, SortKey } from './filters'

const ROLE_TONE: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  super_admin: 'success',
  admin: 'info',
  manager: 'warning',
  employee: 'neutral',
}

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning'> = {
  active: 'success',
  inactive: 'neutral',
  pending: 'warning',
}

const engagementLabel = (v: string | null): string =>
  v === 'freelancer' ? 'Freelancer' : v === 'in_house' ? 'In-house' : '—'

/**
 * The filter bar: one row, the questions people actually ask of a team list —
 * who, which kind, which status, which role.
 *
 * A salary range used to sit here too. It was the first thing a new owner met
 * after clicking "Set up your team", and it pulled them into filtering a list
 * that had nobody in it yet instead of adding the people it was for. Salary
 * questions belong on the Salaries tab, which is built around them.
 */
export function DirectoryFiltersBar({
  filters,
  onChange,
  roles,
}: {
  filters: DirectoryFilters
  onChange: (next: DirectoryFilters) => void
  roles: readonly EmployeeRole[]
}) {
  const set = <K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) =>
    onChange({ ...filters, [key]: value })

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="relative sm:col-span-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Search by name, email or phone…"
          aria-label="Search team"
          className="pl-9"
        />
      </div>

      <Select value={filters.type} onChange={(e) => set('type', e.target.value)} aria-label="Engagement">
        <option value="">All types</option>
        <option value="in_house">In-house staff</option>
        <option value="freelancer">Freelancer / Vendor</option>
      </Select>

      <Select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="pending">Pending</option>
      </Select>

      <Select value={filters.role} onChange={(e) => set('role', e.target.value)} aria-label="Role">
        <option value="">All roles</option>
        <optgroup label="Access level">
          <option value="app:admin">Admin</option>
          <option value="app:manager">Manager</option>
          <option value="app:employee">Employee</option>
        </optgroup>
        {roles.length > 0 && (
          <optgroup label="Job role">
            {roles.map((r) => (
              <option key={r.id} value={`job:${r.id}`}>
                {r.type_name}
              </option>
            ))}
          </optgroup>
        )}
      </Select>

      <Select
        value={filters.sort}
        onChange={(e) => set('sort', e.target.value as SortKey)}
        aria-label="Sort"
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="name">Name (A–Z)</option>
        <option value="salary_high">Salary (high to low)</option>
        <option value="salary_low">Salary (low to high)</option>
      </Select>
    </div>
  )
}

/**
 * Contact-completeness badges (Lovable parity): at a glance, who cannot be
 * reached and who cannot sign in.
 */
export function ContactBadges({ member }: { member: DirectoryMember }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {!member.login_enabled && <StatusBadge>No login</StatusBadge>}
      {!member.email && !member.phone && <StatusBadge tone="danger">Contact missing</StatusBadge>}
      {!member.email && member.phone && <StatusBadge> Email missing</StatusBadge>}
      {!member.phone && member.email && <StatusBadge>Phone missing</StatusBadge>}
    </span>
  )
}

export function DirectoryTable({
  rows,
  canManage,
  showSalary,
  selected,
  onToggle,
  onToggleAll,
  onDelete,
  onManageAccess,
}: {
  rows: readonly DirectoryMember[]
  canManage: boolean
  showSalary: boolean
  /** Selection for the bulk bar. Omit to hide checkboxes. */
  selected?: ReadonlySet<string> | undefined
  onToggle?: ((userId: string, on: boolean) => void) | undefined
  onToggleAll?: ((on: boolean) => void) | undefined
  /** Delete via DeleteEmployeeDialog (with reason), not the inline confirm. */
  onDelete?: ((member: DirectoryMember) => void) | undefined
  onManageAccess?: ((member: DirectoryMember) => void) | undefined
}) {
  const isMobile = useIsMobile()
  const selectable = !!selected && !!onToggle && !!onToggleAll
  const allSelected = selectable && rows.length > 0 && rows.every((m) => selected.has(m.user_id))

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {rows.map((m) => (
          <div key={m.user_id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {selectable && (
                  <input
                    type="checkbox"
                    checked={selected.has(m.user_id)}
                    onChange={(e) => onToggle!(m.user_id, e.target.checked)}
                    aria-label={`Select ${m.name}`}
                  />
                )}
                <Avatar name={m.name} size="sm" />
                <div className="min-w-0">
                <p className="truncate font-medium">
                  <Link to="/employees/$id" params={{ id: m.user_id }} className="hover:underline">
                    {m.name}
                  </Link>
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {[m.email, m.phone, m.alternate_phone].filter(Boolean).join(' · ') || '—'}
                </p>
                <ContactBadges member={m} />
                </div>
              </div>
              <StatusBadge tone={STATUS_TONE[m.status] ?? 'neutral'}>{humanize(m.status)}</StatusBadge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge tone={ROLE_TONE[m.role] ?? 'neutral'}>{humanize(m.role)}</StatusBadge>
              <StatusBadge>{engagementLabel(m.engagement_type)}</StatusBadge>
              {showSalary && m.salary !== null && <StatusBadge>{formatINR(m.salary)}</StatusBadge>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Joined {m.created_at.slice(0, 10)}</p>
            {canManage && (
              <div className="mt-3">
                <RowActions member={m} onDelete={onDelete} onManageAccess={onManageAccess} />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="table-wrap rounded-lg border border-border">
      <table className="table-sticky w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {selectable && (
              <th className="w-10 px-4 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleAll!(e.target.checked)}
                  aria-label="Select all"
                />
              </th>
            )}
            <th className="min-w-56 px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Contact</th>
            <th className="px-4 py-2 font-medium">Access</th>
            <th className="px-4 py-2 font-medium">Job roles</th>
            <th className="px-4 py-2 font-medium">Engagement</th>
            <th className="px-4 py-2 font-medium">Status</th>
            {showSalary && <th className="px-4 py-2 text-right font-medium">Salary</th>}
            <th className="px-4 py-2 font-medium">Joined</th>
            {canManage && (
              <th className="col-pinned-end px-4 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.user_id} className="border-t border-border hover:bg-muted/30">
              {selectable && (
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(m.user_id)}
                    onChange={(e) => onToggle!(m.user_id, e.target.checked)}
                    aria-label={`Select ${m.name}`}
                  />
                </td>
              )}
              <td className="px-4 py-2 font-medium">
                <span className="flex items-center gap-2">
                  <Avatar name={m.name} size="sm" />
                  <span>
                    <Link to="/employees/$id" params={{ id: m.user_id }} className="hover:underline">
                      {m.name}
                    </Link>
                    <ContactBadges member={m} />
                  </span>
                </span>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                <span className="block truncate">{m.email ?? '—'}</span>
                <span className="block truncate text-xs">
                  {[m.phone, m.alternate_phone].filter(Boolean).join(' · ') || '—'}
                </span>
              </td>
              <td className="px-4 py-2">
                <StatusBadge tone={ROLE_TONE[m.role] ?? 'neutral'}>{humanize(m.role)}</StatusBadge>
              </td>
              {/* Chips rather than a comma list: three roles run together read
                  as one long job title at a glance. */}
              <td className="px-4 py-2">
                {m.role_names.length ? (
                  <div className="flex flex-wrap gap-1">
                    {m.role_names.map((name) => (
                      <span
                        key={name}
                        className="whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{engagementLabel(m.engagement_type)}</td>
              <td className="px-4 py-2">
                <StatusBadge tone={STATUS_TONE[m.status] ?? 'neutral'}>{humanize(m.status)}</StatusBadge>
              </td>
              {showSalary && (
                <td className="px-4 py-2 text-right tabular-nums">
                  {m.salary === null ? '—' : formatINR(m.salary)}
                </td>
              )}
              <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{m.created_at.slice(0, 10)}</td>
              {canManage && (
                <td className="col-pinned-end px-2 py-2">
                  <RowActions member={m} onDelete={onDelete} onManageAccess={onManageAccess} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Owner-only row actions. Removal is soft on the server — the person stays on
 * the shoots and payouts they were part of, which is why it reads as "Remove"
 * rather than "Delete".
 *
 * When `onDelete` is provided the row delegates to the DeleteEmployeeDialog
 * (reason + acknowledgement); otherwise it falls back to the inline confirm.
 */
function RowActions({
  member,
  onDelete,
  onManageAccess,
}: {
  member: DirectoryMember
  onDelete?: ((member: DirectoryMember) => void) | undefined
  onManageAccess?: ((member: DirectoryMember) => void) | undefined
}) {
  const update = useUpdateMember()
  const remove = useRemoveMember()
  const reset = useSendReset()
  const confirm = useConfirm()
  const isOwnerRow = member.role === 'super_admin'
  const active = member.status === 'active'

  async function onRemove() {
    if (onDelete) {
      onDelete(member)
      return
    }
    const yes = await confirm({
      title: `Remove ${member.name}?`,
      description:
        'They lose access immediately. Their past shoots, tasks and payouts stay on the record.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (yes) remove.mutate(member.user_id)
  }

  if (isOwnerRow) return <span className="px-2 text-xs text-muted-foreground">Owner</span>

  // Edit and Delete are what people look for on a team list, so they are the
  // two named buttons. The rest are real but occasional, and live in the menu.
  const more: RowMenuItem[] = [
    ...(onManageAccess && member.login_enabled
      ? [{ label: 'Manage access', icon: <ShieldCheck />, onSelect: () => onManageAccess(member) }]
      : []),
    ...(member.login_enabled && member.email
      ? [
          {
            label: 'Send password reset',
            icon: <KeyRound />,
            disabled: reset.isPending,
            onSelect: () =>
              reset.mutate(member.user_id, {
                onSuccess: () => toast.success(`Reset link sent to ${member.name}.`),
              }),
          },
        ]
      : []),
    {
      label: active ? 'Deactivate' : 'Activate',
      icon: active ? <UserX /> : <UserCheck />,
      disabled: update.isPending,
      onSelect: () =>
        update.mutate({ userId: member.user_id, patch: { status: active ? 'inactive' : 'active' } }),
    },
  ]

  return (
    <div className="row-actions flex items-center justify-end gap-0.5">
      <EditMemberDialog member={member} />
      <RowMenu items={more} label={`More actions for ${member.name}`} />
      <Button
        size="sm"
        variant="ghost"
        disabled={remove.isPending}
        title={`Delete ${member.name} from the team`}
        className="text-destructive hover:text-destructive"
        onClick={() => void onRemove()}
      >
        <Trash2 />
        Delete
        <span className="sr-only"> {member.name}</span>
      </Button>
    </div>
  )
}
