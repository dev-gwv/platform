import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  Camera,
  Clock,
  Database,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createShootRequest,
  shootListItem,
  type ShootListItem,
  type ShootRequirementInput,
  type DataRecord,
  type ShootStatus,
  type TeamSlot,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { QuantityStepper, ToneChip, toneAt } from '@/shared/ui/tone-chip'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { humanize } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useShootTypes } from '@/features/projects/api'
import { useDeleteShoot, useServices, useShootPresets, useUpdateShoot } from '@/features/shoots/api'
import { useReleaseSlot, useSlots } from '@/features/allocation/api'
import { AssignTeamDialog } from '@/features/shoots/AssignTeamDialog'
import { AssignmentRow } from '@/features/shoots/AssignmentRow'
import { dataCounts, recordForSlot } from '@/features/data/stage'
import { BulkAssignDialog } from '@/features/shoots/BulkAssignDialog'
import { isLive, requirementFill, shootProgress } from '@/features/shoots/assign'
import { useProjectDataRecords } from '@/features/data/api'
import { ProjectDataStrip } from '@/features/data/ProjectDataStrip'
import { RemindMe } from '@/features/reminders/RemindMe'

/**
 * The shoots a wedding studio books over and over. Used as one-click chips so
 * the common case is a single tap — the studio's own saved types take
 * precedence when it has any.
 */
const QUICK_SHOOTS = [
  'Engagement',
  'Haldi',
  'Mehendi',
  'Sangeet',
  'Wedding',
  'Reception',
  'Pre-Wedding',
  'Cocktail',
  'Bride Getting Ready',
  'Groom Getting Ready',
] as const

/** The crew roles a studio reaches for, when it has not named its own yet. */
const FALLBACK_ROLES = [
  'Traditional Photographer',
  'Candid Photographer',
  'Traditional Videographer',
  'Cinematographer',
  'Drone Operator',
  'Assistant Photographer',
  'BTS Shooter',
] as const

const todayISO = () => new Date().toISOString().slice(0, 10)

const list = shootListItem.array()

const TONE: Record<ShootStatus, 'info' | 'success' | 'warning' | 'danger'> = {
  planned: 'warning',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'danger',
}


const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null

/**
 * This project's shoots, as the desk a studio actually plans from: every day,
 * what each day needs, who is on it, and what is still open.
 *
 * It used to be a read-only list that linked out — requirements were editable
 * only on the global /shoots page, crew only in Team Booking, and a saved
 * preset could only ever be applied while first creating the project. Planning
 * one wedding meant three screens.
 */
export function ShootsTab({ projectId }: { projectId: string }) {
  const { session } = useAuth()
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const qc = useQueryClient()
  const shootTypes = useShootTypes()
  const presets = useShootPresets('shoot')
  const slots = useSlots()
  const dataRecords = useProjectDataRecords(projectId)
  const [customOpen, setCustomOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['shoots', 'project', projectId],
    queryFn: () => callApi(`/shoots?project_id=${projectId}`, { responseSchema: list }),
    enabled: !!session && !!projectId,
    staleTime: 15_000,
  })

  const create = useMutation({
    mutationFn: (input: {
      name: string
      shoot_date?: string
      location?: string
      requirements?: ShootRequirementInput[]
    }) =>
      callApi('/shoots', {
        method: 'POST',
        body: createShootRequest.parse({
          project_id: projectId,
          name: input.name,
          ...(input.shoot_date ? { shoot_date: input.shoot_date } : {}),
          ...(input.location ? { location: input.location } : {}),
          ...(input.requirements?.length ? { requirements: input.requirements } : {}),
          status: 'planned',
        }),
        responseSchema: shootListItem.partial().passthrough(),
      }),
    onSuccess: (_d, v) => {
      toast.success(`${v.name} added`)
      void qc.invalidateQueries({ queryKey: ['shoots'] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setPending(null),
  })

  /**
   * The studio's own saved shoot types come first; the fixed list is the
   * fallback so a brand new studio still gets one-click chips.
   */
  const chips = (() => {
    const own = (shootTypes.data ?? []).filter((t) => !t.is_archived).map((t) => t.name)
    return own.length ? own.slice(0, 10) : [...QUICK_SHOOTS]
  })()

  return (
    <div className="mt-4 flex flex-col gap-3">
      {canEdit && <ProjectDataStrip projectId={projectId} />}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Plan every shoot day and assign crew per requirement
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit && (data?.length ?? 0) > 0 && (
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
              <Users /> Bulk assign
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link to="/shoots">
              <ExternalLink /> All shoots
            </Link>
          </Button>
        </div>
      </div>
      {bulkOpen && <BulkAssignDialog projectId={projectId} onClose={() => setBulkOpen(false)} />}

      {canEdit && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" /> Quick add
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="outline"
                disabled={create.isPending}
                onClick={() => {
                  setPending(name)
                  create.mutate({ name, shoot_date: todayISO() })
                }}
              >
                {pending === name ? 'Adding…' : name}
              </Button>
            ))}
            <Button size="sm" onClick={() => setCustomOpen(true)} disabled={create.isPending}>
              <Plus /> Full form
            </Button>
            {/* A preset used to be applicable only in the create-project wizard,
                so a studio could save the shape of its wedding day and then
                never reach it again. */}
            {(presets.data ?? []).length > 0 && (
              <Select
                value=""
                className="h-8 w-44"
                aria-label="Apply a saved preset"
                onChange={(e) => {
                  const p = (presets.data ?? []).find((x) => x.id === e.target.value)
                  if (!p) return
                  setPending(p.name)
                  create.mutate({
                    name: p.name,
                    shoot_date: todayISO(),
                    requirements: p.payload.requirements,
                  })
                }}
              >
                <option value="">Apply preset…</option>
                {(presets.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            A chip creates the shoot dated today — set the real date, venue and crew on the card.
          </p>
        </div>
      )}

      {customOpen && (
        <CustomShootDialog
          projectId={projectId}
          busy={create.isPending}
          onClose={() => setCustomOpen(false)}
          onCreate={(v, saved) => {
            create.mutate(v, {
              onSuccess: () => {
                saved()
                setCustomOpen(false)
              },
            })
          }}
        />
      )}

      {isLoading ? (
        <SkeletonList rows={3} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No shoots yet"
          description="Add a shoot to plan crew, requirements, and data for this project."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((s) => (
            <ShootPlanner
              key={s.id}
              shoot={s}
              canEdit={canEdit}
              slots={(slots.data ?? []).filter((x) => x.shoot_id === s.id)}
              records={(dataRecords.data ?? []).filter((d) => d.shoot_id === s.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** One shoot day: what it needs, who is on it, and what is still open. */
function ShootPlanner({
  shoot,
  canEdit,
  slots,
  records,
}: {
  shoot: ShootListItem
  canEdit: boolean
  slots: TeamSlot[]
  records: DataRecord[]
}) {
  const update = useUpdateShoot()
  const del = useDeleteShoot()
  const services = useServices()
  const release = useReleaseSlot()
  const confirm = useConfirm()
  /** Open the assign desk; a requirement name focuses it on that role. */
  const [assign, setAssign] = useState<{ requirement?: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [addingReq, setAddingReq] = useState(false)

  const live = slots.filter(isLive)
  const fill = requirementFill(shoot, live)
  const progress = shootProgress(fill)

  /** Per requirement: who holds its seats. */
  const holders = useMemo(() => {
    const m = new Map<string, TeamSlot[]>()
    for (const s of live) {
      const key = (s.service_name ?? '').toLowerCase()
      m.set(key, [...(m.get(key) ?? []), s])
    }
    return m
  }, [live])

  // "Data 2/3": bookings whose footage is copied and backed up, of those that owe it.
  const dataTally = dataCounts(live, records)

  /** Roles this studio uses that are not yet on this day. */
  const roleChips = (() => {
    const own = (services.data ?? []).map((s) => s.name)
    const pool = own.length ? own : [...FALLBACK_ROLES]
    const have = new Set(shoot.requirements.map((r) => r.name.toLowerCase()))
    return pool.filter((n) => !have.has(n.toLowerCase())).slice(0, 8)
  })()

  function setRequirements(next: ShootRequirementInput[]) {
    update.mutate({ id: shoot.id, patch: { requirements: next } })
  }

  const asInput = (): ShootRequirementInput[] =>
    shoot.requirements.map((r) => ({ name: r.name, quantity: r.quantity }))

  const start = timeOf(shoot.start_at)
  const end = timeOf(shoot.end_at)
  const staffed = progress.required > 0 && progress.assigned >= progress.required

  async function removeHolder(sl: TeamSlot) {
    const yes = await confirm({
      title: `Remove ${sl.user_name ?? 'this person'} from ${shoot.name}?`,
      description: 'Their seat opens again. The booking stays in the history.',
      destructive: true,
      confirmLabel: 'Remove',
    })
    if (yes) release.mutate(sl.id, { onSuccess: () => toast.success(`${sl.user_name ?? 'Member'} removed.`) })
  }

  return (
    <Card className={cn('overflow-hidden border-t-4', staffed ? 'border-t-success' : 'border-t-primary')}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
              <Camera className="size-4 text-muted-foreground" />
              {shoot.name}
              <StatusBadge tone={TONE[shoot.status]}>{humanize(shoot.status)}</StatusBadge>
              {/* Beside the name rather than among the edit buttons: crew who
                  cannot edit the shoot can still ask to be reminded of it. */}
              {shoot.status !== 'cancelled' && (
                <RemindMe
                  entityType="shoot"
                  entityId={shoot.id}
                  name={shoot.name}
                  context={shoot.project_name}
                  align="start"
                  className="-my-1"
                />
              )}
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {shoot.shoot_date && <span>{shoot.shoot_date}</span>}
              {start && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {start}
                  {end ? `–${end}` : ''}
                </span>
              )}
              {shoot.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3" />
                  {shoot.location}
                </span>
              )}
              {shoot.map_link && (
                <a
                  href={shoot.map_link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  Map <ExternalLink className="size-3" />
                </a>
              )}
              <span className="flex items-center gap-1">
                <Users className="size-3" />
                {progress.assigned}/{progress.required} assigned
              </span>
              <span className="flex items-center gap-1">
                <Database className="size-3" /> Data {dataTally.done}/{dataTally.needed}
              </span>
            </div>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setAddingReq(true)}>
                <Plus /> Add requirement
              </Button>
              <Button size="sm" onClick={() => setAssign({})} disabled={shoot.requirements.length === 0}>
                <UserPlus /> Assign team
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit ${shoot.name}`}>
                <Pencil />
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link to="/shoots/$shootId" params={{ shootId: shoot.id }}>
                  Open
                </Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                aria-label={`Delete ${shoot.name}`}
                onClick={async () => {
                  const yes = await confirm({
                    title: `Delete ${shoot.name}?`,
                    description: 'Anyone booked on it is released. This cannot be undone.',
                    destructive: true,
                    confirmLabel: 'Delete',
                  })
                  if (yes) del.mutate(shoot.id)
                }}
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </div>

        {progress.required > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Team allocation</span>
              <span className="tabular-nums">{progress.pct}%</span>
            </div>
            <div
              className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={progress.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${shoot.name} team allocated`}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-500',
                  progress.pct === 100 ? 'bg-success' : progress.pct > 0 ? 'bg-warning' : 'bg-destructive',
                )}
                style={{ width: `${progress.pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Adding a role used to mean opening the global shoots page and
            editing the requirement list there. */}
        {canEdit && roleChips.length > 0 && (
          <div className="mt-3 rounded-md border border-border bg-muted/20 p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Users className="size-3.5 text-primary" /> Add more team
              <span className="font-normal text-muted-foreground">— roles this shoot needs. Set how many on the row.</span>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {roleChips.map((name, i) => (
                <ToneChip
                  key={name}
                  tone={toneAt(i)}
                  label={name}
                  disabled={update.isPending}
                  onClick={() => setRequirements([...asInput(), { name, quantity: 1 }])}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {shoot.requirements.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              No roles on this day yet — add the ones it needs above, then assign the team.
            </p>
          ) : (
            fill.map((r) => {
              const req = shoot.requirements.find((x) => x.name === r.name)!
              const on = holders.get(r.name.toLowerCase()) ?? []
              const full = r.open === 0
              return (
                <div
                  key={req.service_id}
                  className={cn(
                    'rounded-md border border-l-4 p-3',
                    full ? 'border-success/40 border-l-success bg-success/5' : 'border-warning/40 border-l-warning bg-warning/5',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{r.name}</span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                        full ? 'bg-success/15 text-success' : 'bg-destructive/10 text-destructive',
                      )}
                    >
                      <Users className="size-3" /> Assigned {r.assigned}/{r.required}
                    </span>
                    {on.length > 0 &&
                      (() => {
                        const t = dataCounts(on, records)
                        if (t.needed === 0) return null
                        return (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                              t.done >= t.needed
                                ? 'bg-success/15 text-success'
                                : t.done > 0
                                  ? 'bg-warning/15 text-warning'
                                  : 'bg-destructive/10 text-destructive',
                            )}
                          >
                            <Database className="size-3" /> Data {t.done}/{t.needed}
                          </span>
                        )
                      })()}
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      {canEdit && (
                        <>
                          <QuantityStepper
                            label={r.name}
                            value={req.quantity}
                            min={1}
                            max={20}
                            onChange={(q) =>
                              setRequirements(asInput().map((x) => (x.name === r.name ? { ...x, quantity: q } : x)))
                            }
                          />
                          <Button
                            size="sm"
                            variant={full ? 'outline' : 'default'}
                            className={cn(!full && 'bg-warning text-card hover:bg-warning/90')}
                            onClick={() => setAssign({ requirement: r.name })}
                          >
                            <UserPlus /> {full ? 'Manage team' : 'Assign team'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            aria-label={`Remove ${r.name}`}
                            onClick={() => setRequirements(asInput().filter((x) => x.name !== r.name))}
                          >
                            <X />
                          </Button>
                        </>
                      )}
                    </span>
                  </div>

                  {on.length === 0 ? (
                    <div className="mt-2 flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                      <div>
                        <p className="font-medium text-warning">Team not assigned</p>
                        <p className="text-muted-foreground">Assign a team member for this requirement using the button above.</p>
                      </div>
                    </div>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {on.map((sl) => (
                        <AssignmentRow
                          key={sl.id}
                          projectId={shoot.project_id}
                          shoot={shoot}
                          slot={sl}
                          record={recordForSlot(sl, records)}
                          canEdit={canEdit}
                          onRemove={() => void removeHolder(sl)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )
            })
          )}
        </div>

        {assign && (
          <AssignTeamDialog shoot={shoot} initialRequirement={assign.requirement} onClose={() => setAssign(null)} />
        )}
        {addingReq && (
          <AddRequirementDialog
            existing={shoot.requirements.map((r) => r.name)}
            suggestions={(services.data ?? []).map((s) => s.name)}
            busy={update.isPending}
            onClose={() => setAddingReq(false)}
            onAdd={(items) =>
              update.mutate(
                { id: shoot.id, patch: { requirements: [...asInput(), ...items] } },
                { onSuccess: () => setAddingReq(false) },
              )
            }
          />
        )}
        {editing && <EditShootDialog shoot={shoot} onClose={() => setEditing(false)} />}
      </CardContent>
    </Card>
  )
}

/**
 * Add one or several roles to a day, each with how many are needed. The
 * studio's own roles are offered as chips; anything else can be typed.
 */
function AddRequirementDialog({
  existing,
  suggestions,
  busy,
  onClose,
  onAdd,
}: {
  existing: string[]
  suggestions: string[]
  busy: boolean
  onClose: () => void
  onAdd: (items: ShootRequirementInput[]) => void
}) {
  const have = new Set(existing.map((n) => n.toLowerCase()))
  const pool = [...new Set([...suggestions, ...FALLBACK_ROLES])].filter((n) => !have.has(n.toLowerCase()))
  const [picked, setPicked] = useState<ShootRequirementInput[]>([])
  const [custom, setCustom] = useState('')
  const isPicked = (n: string) => picked.some((p) => p.name.toLowerCase() === n.toLowerCase())

  function addName(name: string) {
    const n = name.trim()
    if (!n || have.has(n.toLowerCase())) return
    setPicked((p) => (isPicked(n) ? p : [...p, { name: n, quantity: 1 }]))
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Add requirements" description="Pick the roles this shoot needs and how many of each.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {pool.map((n, i) => (
              <ToneChip key={n} tone={toneAt(i)} label={n} selected={isPicked(n)} onClick={() => (isPicked(n) ? setPicked((p) => p.filter((x) => x.name !== n)) : addName(n))} />
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Another role, e.g. Makeup Artist"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addName(custom)
                  setCustom('')
                }
              }}
              aria-label="Another role"
            />
            <Button
              variant="outline"
              disabled={!custom.trim()}
              onClick={() => {
                addName(custom)
                setCustom('')
              }}
            >
              <Plus /> Add
            </Button>
          </div>
          {picked.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-md border border-border p-2">
              {picked.map((p) => (
                <li key={p.name} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <QuantityStepper
                    label={p.name}
                    value={p.quantity}
                    min={1}
                    max={20}
                    onChange={(q) => setPicked((all) => all.map((x) => (x.name === p.name ? { ...x, quantity: q } : x)))}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Drop ${p.name}`}
                    onClick={() => setPicked((all) => all.filter((x) => x.name !== p.name))}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={picked.length === 0 || busy} onClick={() => onAdd(picked)}>
            {busy ? 'Adding…' : `Add ${picked.length || ''} ${picked.length === 1 ? 'role' : 'roles'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Name, when, and where — editable without leaving the project. */
function EditShootDialog({ shoot, onClose }: { shoot: ShootListItem; onClose: () => void }) {
  const update = useUpdateShoot()
  const [name, setName] = useState(shoot.name)
  const [date, setDate] = useState(shoot.shoot_date ?? '')
  const [start, setStart] = useState(shoot.start_at ? shoot.start_at.slice(0, 16) : '')
  const [end, setEnd] = useState(shoot.end_at ? shoot.end_at.slice(0, 16) : '')
  const [location, setLocation] = useState(shoot.location ?? '')
  const [mapLink, setMapLink] = useState(shoot.map_link ?? '')
  const [status, setStatus] = useState<ShootStatus>(shoot.status)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`project-shoot:${shoot.id}`, { name, date, start, end, location, mapLink, status }, (v) => {
    setName(v.name)
    setDate(v.date)
    setStart(v.start)
    setEnd(v.end)
    setLocation(v.location)
    setMapLink(v.mapLink)
    setStatus(v.status)
  })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Edit shoot" description="The day, the hours, and where the crew is going.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-date">Date</Label>
              <Input id="edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-status">Status</Label>
              <Select id="edit-status" value={status} onChange={(e) => setStatus(e.target.value as ShootStatus)}>
                {(['planned', 'confirmed', 'completed', 'cancelled'] as ShootStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-start">Starts</Label>
              <Input id="edit-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-end">Ends</Label>
              <Input id="edit-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-loc">Venue</Label>
            <Input id="edit-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-map">Map link</Label>
            <Input
              id="edit-map"
              value={mapLink}
              onChange={(e) => setMapLink(e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || update.isPending}
              onClick={() =>
                update.mutate(
                  {
                    id: shoot.id,
                    patch: {
                      name: name.trim(),
                      status,
                      shoot_date: date || null,
                      start_at: start ? new Date(start).toISOString() : null,
                      end_at: end ? new Date(end).toISOString() : null,
                      location: location.trim() || null,
                      // '' clears it; the contract turns that into null.
                      map_link: mapLink.trim(),
                    },
                  },
                  {
                    onSuccess: () => {
                      draft.clear()
                      onClose()
                    },
                  },
                )
              }
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The full form, for a shoot that is not one of the usual names. */
function CustomShootDialog({
  projectId,
  busy,
  onClose,
  onCreate,
}: {
  projectId: string
  busy: boolean
  onClose: () => void
  /** `saved` drops the kept draft once the shoot is really created. */
  onCreate: (v: { name: string; shoot_date?: string; location?: string }, saved: () => void) => void
}) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(todayISO())
  const [location, setLocation] = useState('')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`project-shoot:new:${projectId}`, { name, date, location }, (v) => {
    setName(v.name)
    setDate(v.date)
    setLocation(v.location)
  })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Add a shoot" description="Anything the quick chips do not cover.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shoot-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="shoot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cocktail night"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shoot-date">Date</Label>
              <Input id="shoot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shoot-loc">Venue</Label>
              <Input
                id="shoot-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Taj Lands End, Mumbai"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || busy}
              onClick={() =>
                onCreate(
                  {
                    name: name.trim(),
                    ...(date ? { shoot_date: date } : {}),
                    ...(location.trim() ? { location: location.trim() } : {}),
                  },
                  draft.clear,
                )
              }
            >
              {busy ? 'Adding…' : 'Add shoot'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
