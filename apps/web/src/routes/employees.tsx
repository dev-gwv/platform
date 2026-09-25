import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Download, Plus, ShieldCheck, Users } from 'lucide-react'
import type { DirectoryMember } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { HowToUse } from '@/shared/ui/how-to-use'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { downloadCsv } from '@/shared/ui/csv'
import { Select } from '@/shared/ui/input'
import { useDeleteMember, useDirectoryPaged, useEmployeeRoles, useUpdateMember } from '@/features/team/api'
import { AddMemberWizard } from '@/features/team/AddMemberWizard'
import { AddTeamChooser, type AddMode } from '@/features/team/AddTeamChooser'
import { BulkAddMembers } from '@/features/team/BulkAddMembers'
import { AddMorePrompt, useBackToSetup, useFromSetup } from '@/features/onboarding/setup-flow'
import { DeleteEmployeeDialog } from '@/features/team/DeleteEmployeeDialog'
import { DirectoryFiltersBar, DirectoryTable } from '@/features/team/DirectoryTable'
import { InvitationsPanel } from '@/features/team/InvitationsPanel'
import { InviteDialog } from '@/features/team/InviteDialog'
import { ManageAccessDialog } from '@/features/team/ManageAccessDialog'
import { useTeamPowers } from '@/features/team/powers'
import { SalariesTab } from '@/features/team/SalariesTab'
import {
  EMPTY_FILTERS,
  sortDirectory,
  hasActiveFilters,
  toCsv,
  type DirectoryFilters,
  type DirectoryTab,
} from '@/features/team/filters'

export function EmployeesPage() {
  return (
    <AuthedPage module="team_directory">
      <TeamPage />
    </AuthedPage>
  )
}

type Section = 'directory' | 'salaries'

/** `?add=choose|single|bulk` opens straight into adding — how the setup journey links here. */
function addModeFromUrl(): AddMode | null {
  const v = new URLSearchParams(window.location.search).get('add')
  return v === 'choose' || v === 'single' || v === 'bulk' ? v : null
}

function TeamPage() {
  const navigate = useNavigate()
  const powers = useTeamPowers()
  // ?section=salaries opens the salaries straight away (linked from Profit & Loss).
  const [section, setSection] = useState<Section>(() =>
    new URLSearchParams(window.location.search).get('section') === 'salaries' ? 'salaries' : 'directory',
  )
  // Only someone allowed to add people is ever put into it -- anyone else
  // following an old link lands on the directory, not on a form that would
  // refuse them at the last step.
  const [adding, setAddingState] = useState<AddMode | null>(() => (powers.canCreate ? addModeFromUrl() : null))
  // Set once people have just been added: the "add more?" question.
  const [justAdded, setJustAdded] = useState(false)
  const fromSetup = useFromSetup()
  const backToSetup = useBackToSetup()

  const setAdding = (mode: AddMode | null) => {
    setAddingState(mode)
    // Leaving the add flow drops `?add=` too, so a refresh shows the list
    // rather than dropping the owner back into a form they already finished.
    if (mode === null && window.location.search.includes('add=')) {
      void navigate({ to: '/employees', replace: true })
    }
  }

  // Adding someone is its own screen, with nothing else on it: no section
  // tabs, no filters, no list. The owner came to add people; everything else
  // is one Cancel away.
  // Whichever way they were added, the next question is the same one: more,
  // or move on? "Move on" from setup is the next setup step, not this list.
  const onAdded = () => setJustAdded(true)
  const prompt = (
    <AddMorePrompt
      open={justAdded}
      title="Added to your team"
      description="Want to add more people now? You can always add or edit anyone later from the team list."
      moreLabel="Add more people"
      fromSetup={fromSetup}
      onMore={() => {
        setJustAdded(false)
        setAddingState('choose')
      }}
      onDone={() => {
        setJustAdded(false)
        if (fromSetup) backToSetup()
        else setAdding(null)
      }}
    />
  )

  if (adding) {
    return (
      <div className="pt-2">
        {adding === 'choose' ? (
          <AddTeamChooser onPick={setAdding} onCancel={() => setAdding(null)} />
        ) : adding === 'bulk' ? (
          <BulkAddMembers onDone={onAdded} onCancel={() => setAdding('choose')} />
        ) : (
          <AddMemberWizard onDone={onAdded} onCancel={() => setAdding('choose')} />
        )}
        {prompt}
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage employees, managers, salaries, and role assignments."
      />

      <SectionTabs<Section>
        tabs={[
          { value: 'directory', label: 'Directory' },
          { value: 'salaries', label: 'Salaries' },
        ]}
        value={section}
        onChange={setSection}
      />

      {section === 'salaries' ? <SalariesTab /> : <Directory onAdd={() => setAdding('choose')} />}
    </>
  )
}

function Directory({ onAdd }: { onAdd: () => void }) {
  const { session } = useAuth()
  const access = useAccess()
  const { data: roles } = useEmployeeRoles()
  const [tab, setTab] = useState<DirectoryTab>('all')
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteTargets, setDeleteTargets] = useState<DirectoryMember[] | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [accessTarget, setAccessTarget] = useState<DirectoryMember | null>(null)

  // Everything that decides WHICH members exist is now asked of the server,
  // so the count under the pager describes the list above it. Narrowing the
  // already-loaded page meant "freelancers only" could show an empty page 1
  // of 4 with the freelancers sitting on page 3.
  //
  // The Freelance tab is the same question as the engagement filter, so it
  // goes down the same wire rather than trimming the result afterwards.
  const paged = useDirectoryPaged({
    page,
    page_size: pageSize,
    search: filters.q || undefined,
    status: filters.status || undefined,
    engagement_type: tab === 'freelance' ? 'freelancer' : filters.type || undefined,
    role: filters.role || undefined,
  })
  const updateMember = useUpdateMember()
  const deleteMember = useDeleteMember()

  const isOwner = !!session?.is_owner
  const showSalary = access.hasModule('team_salaries')
  // The owner, or someone given Team Directory actions -- who then manages
  // only the people below them (useTeamPowers; the server holds the same rule).
  const powers = useTeamPowers()
  const canEdit = powers.canEdit
  const canDelete = powers.canDelete
  const pageItems = useMemo(() => paged.data?.items ?? [], [paged.data])
  const total = paged.data?.total ?? 0
  const members = pageItems
  // Only the ordering is left to do here: the server returns the right rows,
  // and sorting them is a rearrangement of this page, not a different page.
  const rows = useMemo(() => sortDirectory(members, filters.sort), [members, filters.sort])

  function resetPage(next: DirectoryFilters) {
    setFilters(next)
    setPage(1)
  }

  const onToggle = (userId: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(userId)
      else next.delete(userId)
      return next
    })
  }
  const onToggleAll = (on: boolean) => {
    setSelected(on ? new Set(rows.map((m) => m.user_id)) : new Set())
  }

  const selectedRows = useMemo(() => rows.filter((m) => selected.has(m.user_id)), [rows, selected])
  // Bulk actions touch only the selected people this person may manage.
  const editableSelected = selectedRows.filter((m) => powers.row(m).edit)
  const removableSelected = selectedRows.filter((m) => powers.row(m).remove)

  const exportCsv = (onlySelected = false) => {
    const list = onlySelected ? selectedRows : rows
    if (list.length === 0) {
      toast.error('Nothing to export.')
      return
    }
    downloadCsv(
      `team-directory-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(list),
    )
  }

  async function bulkStatus(status: 'active' | 'inactive') {
    if (editableSelected.length === 0) return
    try {
      await Promise.all(
        editableSelected.map((m) => updateMember.mutateAsync({ userId: m.user_id, patch: { status } })),
      )
      const skipped = selectedRows.length - editableSelected.length
      toast.success(
        `${editableSelected.length} member${editableSelected.length === 1 ? '' : 's'} ${status === 'active' ? 'activated' : 'deactivated'}.` +
          (skipped > 0 ? ` ${skipped} left as they are -- only the owner can change them.` : ''),
      )
      setSelected(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk action failed.')
    }
  }

  async function confirmDelete(reason: string | null) {
    const targets = (deleteTargets ?? []).filter((m) => m.user_id !== session?.user_id)
    if (targets.length === 0) {
      setDeleteTargets(null)
      return
    }
    setDeletePending(true)
    try {
      await Promise.all(
        targets.map((m) => deleteMember.mutateAsync({ userId: m.user_id, reason })),
      )
      toast.success(`${targets.length} member${targets.length === 1 ? '' : 's'} deleted.`)
      setSelected(new Set())
      setDeleteTargets(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeletePending(false)
    }
  }

  // The how-to panel is for a studio that has nobody yet. Once real people are
  // on the list it is a block of instructions sitting between the owner and
  // the list they came to manage. The owner's own row always exists, so a
  // total of one with no filters narrowing it means "nobody added yet".
  const teamIsEmpty =
    paged.isSuccess && total <= 1 && !hasActiveFilters(filters) && tab === 'all'

  return (
    <>
      {teamIsEmpty && (
        <HowToUse
          className="mt-6"
          title="Manage your team"
          description="Add photographers, editors, managers, and other team members here."
          steps={[
            'Create team roles first.',
            'Add team members with login access.',
            'Assign them to shoots and tasks.',
          ]}
        />
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Team Directory</h2>
        <div className="flex flex-wrap items-center gap-2">
          {access.hasModule('team_roles') && (
            <Button variant="outline" asChild>
              <Link to="/settings/roles">
                <ShieldCheck /> Roles &amp; Access
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => exportCsv(false)} disabled={rows.length === 0}>
            <Download /> Export CSV
          </Button>
          {powers.canCreate && <InviteDialog />}
          {powers.canCreate && (
            <Button onClick={onAdd}>
              <Plus /> Add Team Member
            </Button>
          )}
        </div>
      </div>

      <FilterTabs<DirectoryTab>
        className="mt-4"
        tabs={[
          { value: 'all', label: 'All', count: total },
          { value: 'freelance', label: 'Freelance / Non-salaried', count: total },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v)
          setPage(1)
        }}
      />

      <div className="mt-4">
        <DirectoryFiltersBar filters={filters} onChange={resetPage} roles={roles ?? []} />
      </div>

      {(canEdit || canDelete) && selected.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
          <span className="text-sm">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {canEdit && editableSelected.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => void bulkStatus('active')}>
                Activate
              </Button>
            )}
            {canEdit && editableSelected.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => void bulkStatus('inactive')}>
                Deactivate
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => exportCsv(true)}>
              Export selected
            </Button>
            {canDelete && removableSelected.length > 0 && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeleteTargets(removableSelected)}
              >
                Delete selected
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="mt-4">
        {paged.isLoading ? (
          <SkeletonList rows={5} columns={6} />
        ) : paged.isError ? (
          <ErrorState onRetry={() => void paged.refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              {/* "No employees yet" and "none match this filter" are different
                  sentences, and the wrong one is worse than none: a studio of
                  forty told to add its first employee assumes the list broke.
                  This used to read `total === 0`, which worked only while the
                  total ignored the filters -- now that it follows them, the
                  question has to be asked directly. */}
              {total === 0 && !hasActiveFilters(filters) && tab === 'all' ? (
                <EmptyState
                  title="No employees found yet."
                  description="Add your first employee to start building your team."
                  action={powers.canCreate ? <Button onClick={onAdd}>Add Employee</Button> : undefined}
                />
              ) : (
                <EmptyState
                  title="Nobody matches these filters."
                  description="Try a different search, or clear the filters to see everyone."
                  action={
                    hasActiveFilters(filters) ? (
                      <Button variant="outline" onClick={() => resetPage(EMPTY_FILTERS)}>
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <DirectoryTable
              rows={rows}
              canManage={canEdit || canDelete}
              rowAccess={powers.row}
              showSalary={showSalary}
              selected={selected}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
              onDelete={(m) => setDeleteTargets([m])}
              onManageAccess={isOwner ? setAccessTarget : undefined}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" />
                Showing {rows.length} of {total}
                {paged.isFetching && ' · refreshing…'}
              </p>
              <div className="ml-auto flex items-center gap-2">
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
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">Page {page}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * pageSize >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <DeleteEmployeeDialog
        open={!!deleteTargets && deleteTargets.length > 0}
        onOpenChange={(v) => {
          if (!v) setDeleteTargets(null)
        }}
        count={deleteTargets?.length ?? 0}
        pending={deletePending}
        onConfirm={confirmDelete}
      />

      <ManageAccessDialog
        member={accessTarget}
        open={!!accessTarget}
        onOpenChange={(v) => {
          if (!v) setAccessTarget(null)
        }}
      />

      {powers.canCreate && <InvitationsPanel />}
    </>
  )
}
