import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { DirectoryMember, EmployeeRole, LibraryRole, ProductionStage } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { RoleTile } from '@/shared/ui/icon-tile'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { Input, Label, Select } from '@/shared/ui/input'
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
  const [tab, setTab] = useState<'roles' | 'people'>('roles')

  return (
    <>
      <PageHeader
        title="Roles & access"
        description="What each person does on a shoot."
        actions={isOwner ? <RoleDialog /> : undefined}
      />

      <SectionTabs
        variant="underline"
        label="Roles"
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: 'roles',
            label: `Your roles${roles.data ? ` \u00b7 ${roles.data.length}` : ''}`,
          },
          { value: 'people', label: 'Who does what' },
        ]}
      />

      {tab === 'roles' ? (
        roles.isLoading ? (
          <SkeletonCards count={3} />
        ) : roles.isError ? (
          <ErrorState onRetry={() => void roles.refetch()} />
        ) : (
          <RoleList owned={roles.data ?? []} isOwner={isOwner} />
        )
      ) : (
        <Card>
          <CardContent className="pt-4">
            {directory.isLoading ? (
              <SkeletonCards count={3} />
            ) : directory.isError ? (
              <ErrorState onRetry={() => void directory.refetch()} />
            ) : !directory.data || directory.data.length === 0 ? (
              <EmptyState
                title="No team members yet"
                description="Roles are given to people, so add your team first."
                action={
                  <Button variant="outline" asChild>
                    <Link to="/employees">Go to the team</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {directory.data.map((m) => (
                  <li
                    key={m.user_id}
                    className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {m.role_names.length ? m.role_names.join(', ') : 'No role yet'}
                      </p>
                    </div>
                    {isOwner && <AssignDialog member={m} roles={roles.data ?? []} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}

/**
 * The studio's roles, one short list per stage of work, with the roles it
 * could add shown as chips underneath.
 *
 * This replaced one grid where every suggested role was a full dashed card
 * with a "Default" badge beside the studio's own. The owner found it
 * scattered: the eye could not tell the roles the studio has from the ones it
 * might want. Now the list is what you have; a chip is one tap to add.
 */
function RoleList({ owned, isOwner }: { owned: readonly EmployeeRole[]; isOwner: boolean }) {
  const library = useRoleLibrary()
  const create = useCreateRole()
  const taken = new Set(owned.map((r) => r.role_code))
  const suggestions: readonly LibraryRole[] = isOwner
    ? (library.data ?? []).filter((r) => !taken.has(r.role_code))
    : []

  if (owned.length === 0 && suggestions.length === 0) {
    return (
      <EmptyState
        title="No roles yet"
        description="Add what people do, like Photographer or Editor, so you can book them by it."
        action={isOwner ? <RoleDialog /> : undefined}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {STAGE_ORDER.map((stage) => {
        const mine = owned
          .filter((r) => stageOf(r) === stage)
          .sort((a, b) => a.type_name.localeCompare(b.type_name))
        const more = suggestions
          .filter((r) => r.stage === stage)
          .sort((a, b) => a.type_name.localeCompare(b.type_name))
        if (mine.length === 0 && more.length === 0) return null
        return (
          <Card key={stage}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {STAGE_LABEL[stage]}
                <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                  {mine.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {mine.length > 0 && (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {mine.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                      <RoleTile name={r.type_name} size="sm" />
                      <p className="min-w-0 flex-1 truncate font-medium">{r.type_name}</p>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {r.member_count === 0
                          ? 'Nobody yet'
                          : `${r.member_count} ${r.member_count === 1 ? 'person' : 'people'}`}
                      </span>
                      {isOwner && <RoleRowActions role={r} />}
                    </li>
                  ))}
                </ul>
              )}
              {more.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-muted-foreground">Add:</span>
                  {more.map((r) => (
                    <button
                      key={r.role_code}
                      type="button"
                      disabled={create.isPending}
                      onClick={() =>
                        create.mutate({
                          type_name: r.type_name,
                          role_code: r.role_code,
                          stage: r.stage,
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
                    >
                      <Plus className="size-3" aria-hidden /> {r.type_name}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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
