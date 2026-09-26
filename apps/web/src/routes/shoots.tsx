import { useMemo, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Plus, MapPin, Pencil, Trash2, ExternalLink, CalendarDays, Eye, UserPlus, X } from 'lucide-react'
import { shootListItem, shootRequirementInput, z, type CreateShootRequest, type ShootListItem, type ShootRequirementInput, type ShootStatus, type UpdateShootRequest } from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useSlots } from '@/features/allocation/api'
import { crewState, rolesFilled, rolesNeeded, type CrewState } from '@ipc/domain'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { useConfirm } from '@/shared/ui/confirm'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SendTermsDialog } from '@/features/team-terms/SendTermsDialog'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useProjects } from '@/features/projects/api'
import { useDeleteShoot, useUpdateShoot } from '@/features/shoots/api'
import { mapHref } from '@/features/shoots/map-link'
import { AssignTeamDialog } from '@/features/shoots/AssignTeamDialog'
import { RemindMe } from '@/features/reminders/RemindMe'

const list = shootListItem.array()
const TONE: Record<ShootStatus, 'info' | 'success' | 'warning' | 'danger'> = {
  planned: 'warning',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'danger',
}

function useShoots() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
}

export function ShootsPage() {
  return (
    <AuthedPage module="projects">
      <Shoots />
    </AuthedPage>
  )
}

type SortKey = 'date_asc' | 'date_desc' | 'name_az' | 'recent'
type DateFilter = 'all' | 'upcoming' | 'past' | 'today'
type CrewFilter = 'all' | CrewState

/** Warning, not danger: an uncrewed shoot is work to do, not a failure. */
const CREW_TONE: Record<CrewState, 'success' | 'warning' | 'neutral'> = {
  full: 'success',
  partial: 'warning',
  unassigned: 'warning',
  unplanned: 'neutral',
}

function Shoots() {
  const { data, isLoading, isError, refetch } = useShoots()
  // Booked crew, to answer "which shoots still need people". Team Booking
  // counts that on its own screen and could not say WHICH — the tile was a
  // number with no way through to the rows behind it.
  const slots = useSlots()
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const canDelete = access.hasAction('projects', 'delete')
  const confirm = useConfirm()
  const del = useDeleteShoot()
  const [assignTo, setAssignTo] = useState<ShootListItem | null>(null)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | ShootStatus>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [sort, setSort] = useState<SortKey>('date_asc')
  const [crew, setCrew] = useState<CrewFilter>(
    // ?crew=unassigned arrives from Team Booking's tile.
    () => {
      const v = new URLSearchParams(window.location.search).get('crew') ?? ''
      return (['unplanned', 'unassigned', 'partial', 'full'] as const).includes(v as CrewState)
        ? (v as CrewState)
        : 'all'
    },
  )

  const today = new Date().toISOString().slice(0, 10)
  const all = useMemo(() => data ?? [], [data])

  // The same rule Team Booking uses, from @ipc/domain rather than a second
  // copy — a tile saying three while the filter shows two is worse than
  // neither existing.
  const crewOf = useMemo(() => {
    const bookings = slots.data ?? []
    const m = new Map<string, { state: CrewState; filled: number; needed: number }>()
    for (const sh of all) {
      m.set(sh.id, {
        state: crewState(sh.id, sh.requirements, bookings),
        filled: rolesFilled(sh.id, sh.requirements, bookings),
        needed: rolesNeeded(sh.requirements),
      })
    }
    return m
  }, [all, slots.data])

  // Stats over the unfiltered set (Lovable parity).
  const stats = useMemo(
    () => ({
      total: all.length,
      upcoming: all.filter((s) => s.shoot_date && s.shoot_date >= today).length,
      past: all.filter((s) => s.shoot_date && s.shoot_date < today).length,
      unscheduled: all.filter((s) => !s.shoot_date).length,
      needsCrew: all.filter((s) => {
        const c = crewOf.get(s.id)?.state
        return c === 'unassigned' || c === 'partial'
      }).length,
    }),
    [all, today, crewOf],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = all.filter((s) => {
      if (status !== 'all' && s.status !== status) return false
      if (dateFilter === 'upcoming' && !(s.shoot_date && s.shoot_date >= today)) return false
      if (dateFilter === 'past' && !(s.shoot_date && s.shoot_date < today)) return false
      if (dateFilter === 'today' && s.shoot_date !== today) return false
      if (crew !== 'all' && crewOf.get(s.id)?.state !== crew) return false
      if (q) {
        const hay = [s.name, s.project_name ?? '', s.location ?? '', s.client_name ?? '']
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'name_az') return a.name.localeCompare(b.name)
      if (sort === 'recent') return b.id.localeCompare(a.id)
      const ak = a.shoot_date || '9999-99-99'
      const bk = b.shoot_date || '9999-99-99'
      return sort === 'date_desc' ? bk.localeCompare(ak) : ak.localeCompare(bk)
    })
    return sorted
  }, [all, search, status, dateFilter, crew, crewOf, sort, today])

  async function onDelete(s: ShootListItem) {
    const yes = await confirm({
      title: `Delete shoot "${s.name}"?`,
      description: 'This releases related team bookings. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (yes) del.mutate(s.id)
  }

  const hasFilters = search.trim() !== '' || status !== 'all' || dateFilter !== 'all'

  return (
    <>
      <PageHeader
        title="Shoots"
        description="Every scheduled shoot across your projects."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/shoots/my">My shoots</Link>
            </Button>
            {canEdit && <ShootDialog />}
          </>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Upcoming" value={stats.upcoming} />
        <StatCard label="Past" value={stats.past} />
        <StatCard label="Unscheduled" value={stats.unscheduled} />
        <StatCard label="Needs crew" value={stats.needsCrew} />
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search shoot, project, client, venue…"
          aria-label="Search shoots"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'all' | ShootStatus)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="planned">Planned</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)} aria-label="Date">
            <option value="all">All dates</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="today">Today</option>
          </Select>
          <Select
            value={crew}
            onChange={(e) => setCrew(e.target.value as CrewFilter)}
            aria-label="Crew"
          >
            <option value="all">All crew states</option>
            <option value="unassigned">Needs crew — nobody booked</option>
            <option value="partial">Partly crewed</option>
            <option value="full">Fully crewed</option>
            {/* Kept separate from "needs crew": nothing has been asked for
                yet, so nobody is missing. */}
            <option value="unplanned">No roles set yet</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
            <option value="date_asc">Date ↑</option>
            <option value="date_desc">Date ↓</option>
            <option value="name_az">Name A–Z</option>
          </Select>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {rows.length} of {all.length} shoots</span>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatus('all'); setDateFilter('all'); setSort('date_asc') }}>
              <X /> Clear filters
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <SkeletonCards count={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'No shoots scheduled' : 'No shoots match these filters'}
          description="Add a shoot to a project to plan crew and data."
          action={canEdit && all.length === 0 ? <ShootDialog /> : undefined}
        />
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    <Camera className="size-4 text-muted-foreground" />
                    <Link to="/shoots/$shootId" params={{ shootId: s.id }} className="hover:text-primary hover:underline">
                      {s.name}
                    </Link>
                  </span>
                  <StatusBadge tone={TONE[s.status]}>{humanize(s.status)}</StatusBadge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{s.project_name ?? '—'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {s.shoot_date ? (
                    <span className="flex items-center gap-1">
                      <CalendarDays className="size-3" /> {s.shoot_date}
                    </span>
                  ) : (
                    <span>Unscheduled</span>
                  )}
                  {s.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" />
                      {s.location}
                    </span>
                  )}
                  {(() => {
                    const href = mapHref(s.map_link)
                    if (href)
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-primary hover:underline"
                        >
                          Map <ExternalLink className="size-3" />
                        </a>
                      )
                    return s.map_link ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3" />
                        <span className="select-all">{s.map_link}</span>
                      </span>
                    ) : null
                  })()}
                </div>
                {s.requirements.length > 0 && (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      Needs: {s.requirements.map((r) => `${r.name} ×${r.quantity}`).join(', ')}
                    </span>
                    {(() => {
                      const c = crewOf.get(s.id)
                      if (!c) return null
                      return (
                        <StatusBadge tone={CREW_TONE[c.state]}>
                          {c.state === 'full'
                            ? 'Fully crewed'
                            : `${c.filled} of ${c.needed} booked`}
                        </StatusBadge>
                      )
                    })()}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/shoots/$shootId" params={{ shootId: s.id }}>
                      <Eye /> View
                    </Link>
                  </Button>
                  {canEdit && s.status !== 'cancelled' && (
                    <Button size="sm" onClick={() => setAssignTo(s)}>
                      <UserPlus /> Assign team
                    </Button>
                  )}
                  {canEdit && <EditShootDialog shoot={s} />}
                  {canEdit && access.hasModule('team_terms') && <SendTermsDialog shoot={s} />}
                  {canDelete && (
                    <Button size="sm" variant="ghost" title="Delete shoot" onClick={() => void onDelete(s)} disabled={del.isPending}>
                      <Trash2 />
                    </Button>
                  )}
                  {s.status !== 'cancelled' && (
                    <RemindMe entityType="shoot" entityId={s.id} name={s.name} context={s.project_name} className="ml-auto" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {assignTo && <AssignTeamDialog key={assignTo.id} shoot={assignTo} onClose={() => setAssignTo(null)} />}
    </>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

/** A simple add/remove list of "who and what this day needs" — no autocomplete, just name + quantity. */
function RequirementsEditor({ value, onChange }: { value: ShootRequirementInput[]; onChange: (next: ShootRequirementInput[]) => void }) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')

  function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    onChange([...value, { name: trimmed, quantity: Number(quantity) || 1 }])
    setName('')
    setQuantity('1')
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Requirements (optional)</Label>
      {value.length > 0 && (
        <ul className="flex flex-col gap-1">
          {value.map((r, i) => (
            <li key={i} className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-sm">
              <span>
                {r.name} × {r.quantity}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drone pilot" className="flex-1" />
        <Input
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-16"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!name.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}

function ShootDialog() {
  const qc = useQueryClient()
  const { data: projects } = useProjects()
  const create = useMutation({
    mutationFn: (input: CreateShootRequest) =>
      callApi('/shoots', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
    onSuccess: () => {
      toast.success('Shoot added')
      void qc.invalidateQueries({ queryKey: ['shoots'] })
    },
  })
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
  const [mapLink, setMapLink] = useState('')
  const [requirements, setRequirements] = useState<ShootRequirementInput[]>([])
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(open ? 'shoots-page:new' : null, { projectId, name, date, location, mapLink, requirements }, (v) => {
    setProjectId(v.projectId)
    setName(v.name)
    setDate(v.date)
    setLocation(v.location)
    setMapLink(v.mapLink)
    setRequirements(v.requirements)
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (!projectId) throw new Error('Pick a project.')
      const body: CreateShootRequest = {
        project_id: projectId,
        name: name.trim(),
        status: 'planned',
        ...(date ? { shoot_date: date } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(mapLink.trim() ? { map_link: mapLink.trim() } : {}),
        ...(requirements.length > 0 ? { requirements } : {}),
      }
      await create.mutateAsync(body)
      draft.clear()
      setOpen(false)
      setName('')
      setDate('')
      setLocation('')
      setMapLink('')
      setRequirements([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the shoot.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New shoot
        </Button>
      </DialogTrigger>
      <DialogContent title="New shoot" description="Schedule a shoot for a project.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Project</Label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
              <option value="">— Select —</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Shoot name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wedding day" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Map link (optional)</Label>
            <Input value={mapLink} onChange={(e) => setMapLink(e.target.value)} placeholder="Paste the map link" />
          </div>
          <RequirementsEditor value={requirements} onChange={setRequirements} />
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
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create shoot'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditShootDialog({ shoot }: { shoot: ShootListItem }) {
  const update = useUpdateShoot()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(shoot.name)
  const [date, setDate] = useState(shoot.shoot_date ?? '')
  const [location, setLocation] = useState(shoot.location ?? '')
  const [mapLink, setMapLink] = useState(shoot.map_link ?? '')
  const [status, setStatus] = useState<ShootStatus>(shoot.status)
  const [requirements, setRequirements] = useState<ShootRequirementInput[]>(
    shoot.requirements.map((r) => ({ name: r.name, quantity: r.quantity })),
  )
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `shoots-page:edit:${shoot.id}` : null,
    { name, date, location, mapLink, status, requirements },
    (v) => {
      setName(v.name)
      setDate(v.date)
      setLocation(v.location)
      setMapLink(v.mapLink)
      setStatus(v.status)
      setRequirements(v.requirements)
    },
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const body: UpdateShootRequest = {
        name: name.trim(),
        shoot_date: date || null,
        location: location.trim() || null,
        map_link: mapLink.trim() || '',
        status,
        requirements: requirements.map((r) => shootRequirementInput.parse(r)),
      }
      await update.mutateAsync({ id: shoot.id, patch: body })
      draft.clear()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the shoot.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit shoot" description="Anything set when it was scheduled can be corrected here.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Shoot name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Map link</Label>
              <Input value={mapLink} onChange={(e) => setMapLink(e.target.value)} placeholder="Paste the map link" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as ShootStatus)}>
                <option value="planned">Planned</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
          </div>
          <RequirementsEditor value={requirements} onChange={setRequirements} />
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
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
