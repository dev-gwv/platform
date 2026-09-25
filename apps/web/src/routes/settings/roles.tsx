import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { DirectoryMember, EmployeeRole, LibraryRole, ProductionStage } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useConfirm } from '@/shared/ui/confirm'
import {
  useAssignRoles,
  useCreateRole,
  useDeleteRole,
  useDirectory,
  useEmployeeRoles,
  useRoleLibrary,
  useUpdateRole,
} from '@/features/team/api'
import { STAGE_LABEL, STAGE_ORDER, stageOf } from '@/features/team/role-stages'

/** "Drone Operator" → "drone_operator", the code the API stores alongside it. */
const toCode = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

export function RolesAccessPage() {
  return (
    <AuthedPage module="team_roles">
      <RolesAccess />
    </AuthedPage>
  )
}

function RolesAccess() {
  const { session } = useAuth()
  const roles = useEmployeeRoles()
  const directory = useDirectory()
  const isOwner = !!session?.is_owner

  return (
    <>
      <PageHeader
        title="Roles & Access"
        description="The job roles your studio books people for, and who holds them."
        actions={isOwner ? <RoleDialog /> : undefined}
      />
      <SettingsTabs />

      <HowToUse
        title="Create work roles"
        description="Job roles say what a person does. Access level, set on the member, says what they can open."
        steps={[
          'Pick roles like Photographer, Editor or Cinematographer.',
          'Keep them grouped by the stage of work they belong to.',
          'Assign them while adding a team member, or below.',
        ]}
      />

      <Card className="mt-6">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-4">
          <div>
            <CardTitle>Role library</CardTitle>
            <CardDescription>Grouped by the stage of production they belong to.</CardDescription>
          </div>
          {isOwner && <RoleDialog />}
        </CardHeader>
        <CardContent>
          {roles.isLoading ? (
            <SkeletonCards count={3} />
          ) : roles.isError ? (
            <ErrorState onRetry={() => void roles.refetch()} />
          ) : (
            <RoleGrid owned={roles.data ?? []} isOwner={isOwner} />
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="pb-4">
          <CardTitle>Role assignments</CardTitle>
          <CardDescription>Assign roles to existing team members.</CardDescription>
        </CardHeader>
        <CardContent>
          {directory.isLoading ? (
            <SkeletonCards count={3} />
          ) : directory.isError ? (
            <ErrorState onRetry={() => void directory.refetch()} />
          ) : !directory.data || directory.data.length === 0 ? (
            <EmptyState
              title="No team members yet"
              description="Job roles are assigned to people, so there is nobody to assign them to yet."
              action={
                <Button variant="outline" asChild>
                  <Link to="/employees">Go to team directory</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {directory.data.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {m.role_names.length ? m.role_names.join(', ') : 'No job roles'}
                    </p>
                  </div>
                  {isOwner && <AssignDialog member={m} roles={roles.data ?? []} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}

/**
 * Every role a studio could book, in one grid: the ones they have made, and
 * the platform defaults they have not.
 *
 * Two lists would ask the reader to care which side of that line a role sits
 * on before they can find it. They are the same choice — "Candid
 * Photographer" is Candid Photographer either way — so it is one grid, and the
 * Default badge is the only thing separating them. Tapping a default copies it
 * into the studio's own roles; it does not point at the catalogue, so renaming
 * it afterwards is nobody else's business.
 */
function RoleGrid({ owned, isOwner }: { owned: readonly EmployeeRole[]; isOwner: boolean }) {
  const library = useRoleLibrary()
  const create = useCreateRole()
  const taken = new Set(owned.map((r) => r.role_code))

  type Cell =
    | { kind: 'owned'; key: string; stage: ProductionStage; role: EmployeeRole }
    | { kind: 'default'; key: string; stage: ProductionStage; role: LibraryRole }

  const cells: Cell[] = [
    ...owned.map(
      (role): Cell => ({ kind: 'owned', key: role.id, stage: stageOf(role), role }),
    ),
    // Owners can adopt a default; everyone else would only be looking at a
    // button they are not allowed to press.
    ...(isOwner
      ? (library.data ?? [])
          .filter((r) => !taken.has(r.role_code))
          .map((role): Cell => ({ kind: 'default', key: role.role_code, stage: role.stage, role }))
      : []),
  ]

  if (cells.length === 0) {
    return (
      <EmptyState
        title="No job roles yet"
        description="Create your first role to start assigning people to shoots by what they do."
        action={isOwner ? <RoleDialog /> : undefined}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {STAGE_ORDER.map((stage) => {
        const inStage = cells
          .filter((c) => c.stage === stage)
          .sort((a, b) => a.role.type_name.localeCompare(b.role.type_name))
        if (inStage.length === 0) return null
        return (
          <div key={stage}>
            <p className="mb-2 text-sm font-medium">{STAGE_LABEL[stage]}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {inStage.map((cell) =>
                cell.kind === 'owned' ? (
                  <div key={cell.key} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate font-medium">{cell.role.type_name}</p>
                      <StatusBadge>
                        {cell.role.member_count}{' '}
                        {cell.role.member_count === 1 ? 'member' : 'members'}
                      </StatusBadge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {STAGE_LABEL[cell.stage]}
                      </p>
                      {isOwner && <RoleRowActions role={cell.role} />}
                    </div>
                  </div>
                ) : (
                  <button
                    key={cell.key}
                    type="button"
                    disabled={create.isPending}
                    title={`Add ${cell.role.type_name} to your roles`}
                    onClick={() =>
                      create.mutate({
                        type_name: cell.role.type_name,
                        role_code: cell.role.role_code,
                        stage: cell.role.stage,
                      })
                    }
                    className="rounded-lg border border-dashed border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate font-medium">{cell.role.type_name}</p>
                      <StatusBadge tone="info">Default</StatusBadge>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <Plus className="size-3" aria-hidden />
                      Add to your roles
                    </p>
                  </button>
                ),
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RoleRowActions({ role }: { role: EmployeeRole }) {
  const del = useDeleteRole()
  const confirm = useConfirm()

  async function onDelete() {
    // Parity with Lovable: an assigned role cannot be deleted outright — unassign first.
    if (role.member_count > 0) {
      await confirm({
        title: `Cannot delete ${role.type_name} yet`,
        description: `${role.member_count} member${role.member_count === 1 ? '' : 's'} still hold${role.member_count === 1 ? 's' : ''} this role. Remove it from everyone first, then delete.`,
        confirmLabel: 'Understood',
      })
      return
    }
    const yes = await confirm({
      title: `Delete the ${role.type_name} role?`,
      description: 'Nobody holds this role.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (yes) del.mutate(role.id)
  }

  return (
    <div className="flex items-center gap-1">
      <RoleDialog role={role} />
      <Button size="sm" variant="ghost" disabled={del.isPending} onClick={() => void onDelete()}>
        <Trash2 />
        <span className="sr-only">Delete {role.type_name}</span>
      </Button>
    </div>
  )
}

/** Create or rename a job role. The code follows the name unless it's edited. */
function RoleDialog({ role }: { role?: EmployeeRole }) {
  const create = useCreateRole()
  const update = useUpdateRole()
  const editing = !!role
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(role?.type_name ?? '')
  const [code, setCode] = useState(role?.role_code ?? '')
  const [codeTouched, setCodeTouched] = useState(editing)
  // An existing role with no saved stage shows the one its name implies, so
  // saving the dialog settles it rather than leaving the guess in place.
  const [stage, setStage] = useState<ProductionStage>(
    role ? stageOf(role) : 'production',
  )
  const busy = create.isPending || update.isPending
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(open ? `job-role:${role?.id ?? 'new'}` : null, { name, code, codeTouched, stage }, (v) => {
    setName(v.name)
    setCode(v.code)
    setCodeTouched(v.codeTouched)
    setStage(v.stage)
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = {
      type_name: name.trim(),
      role_code: (codeTouched ? code : toCode(name)).trim(),
      stage,
    }
    const done = {
      onSuccess: () => {
        draft.clear()
        setOpen(false)
      },
    }
    if (editing) update.mutate({ id: role.id, patch: body }, done)
    else create.mutate(body, done)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o && !editing) {
          setName('')
          setCode('')
          setCodeTouched(false)
        }
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button size="sm" variant="ghost">
            <Pencil />
            <span className="sr-only">Edit {role.type_name}</span>
          </Button>
        ) : (
          <Button>
            <Plus /> New role
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={editing ? `Edit ${role.type_name}` : 'New job role'}
        description="The code is what other parts of the system store; the name is what people read."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Photographer"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Code</Label>
            <Input
              value={codeTouched ? code : toCode(name)}
              onChange={(e) => {
                setCodeTouched(true)
                setCode(e.target.value)
              }}
              placeholder="photographer"
              className="font-mono"
              disabled={editing}
              title={editing ? 'The code is immutable after creation — other records store it.' : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {editing
                ? 'The code cannot be changed after creation.'
                : 'Lowercase letters, numbers and underscores.'}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Part of the job</Label>
            <Select value={stage} onChange={(e) => setStage(e.target.value as ProductionStage)}>
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Only used to group this list.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? 'Saving…' : editing ? 'Save role' : 'Create role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AssignDialog({ member, roles }: { member: DirectoryMember; roles: EmployeeRole[] }) {
  const assign = useAssignRoles()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>(member.role_ids)

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((r) => r !== id) : [...s, id]))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setSelected(member.role_ids)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Manage roles
        </Button>
      </DialogTrigger>
      <DialogContent title={`Job roles for ${member.name}`} description="Pick everything they can be booked for.">
        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create a job role first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => {
              const on = selected.includes(r.id)
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggle(r.id)}
                  aria-pressed={on}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    on
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {r.type_name}
                </button>
              )
            })}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={assign.isPending}
            onClick={() =>
              assign.mutate(
                { userId: member.user_id, roles: { role_ids: selected } },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            {assign.isPending ? 'Saving…' : 'Save roles'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
