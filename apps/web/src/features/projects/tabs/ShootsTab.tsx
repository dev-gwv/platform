import { SavePresetButton } from '@/features/shoots/SavePresetButton'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Check,
  Clock,
  Database,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
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
  type TeamTermsSend,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { useTeamTermsSends } from '@/features/team-terms/api'
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
import { dataCounts, optedOut, recordForSlot } from '@/features/data/stage'
import { CrewDataDialog } from '@/features/data/CrewDataDialog'
import { BulkAssignDialog } from '@/features/shoots/BulkAssignDialog'
import { isLive, requirementFill, shootHours, shootProgress } from '@/features/shoots/assign'
import { ShootWhenFields, whenOfShoot, whenToPatch, type WhenFields } from '@/features/shoots/ShootWhenFields'
import { mapHref } from '@/features/shoots/map-link'
import { useProjectDataRecords } from '@/features/data/api'
import { RemindMe } from '@/features/reminders/RemindMe'
import { EventIcon, EventTile, RoleTile } from '@/shared/ui/icon-tile'
import { QUICK_SHOOTS } from '@/features/projects/wizard'

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

// Calm by default: only a finished day (green) or a cancelled one (red) is coloured.
const TONE: Record<ShootStatus, 'neutral' | 'success' | 'danger'> = {
  planned: 'neutral',
  confirmed: 'neutral',
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
export function ShootsTab({
  projectId,
  focusAssign = false,
  onFocused,
}: {
  projectId: string
  /** Arrived from "Book the team": point at the first day still short of people. */
  focusAssign?: boolean
  onFocused?: (() => void) | undefined
}) {
  const { session } = useAuth()
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const qc = useQueryClient()
  const shootTypes = useShootTypes()
  const presets = useShootPresets('shoot')
  const slots = useSlots()
  const dataRecords = useProjectDataRecords(projectId)
  const [customOpen, setCustomOpen] = useState(false)
  // The event chips are the empty state; once a day exists they fold behind
  // "+ Add event" so the first card sits right under the toolbar. The owner:
  // "I'm going to the shoot, and then again 'Add your events' is coming up".
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  /** Shoots a chip made with today's date, until someone sets the real one. */
  const [placeholderDates, setPlaceholderDates] = useState<Set<string>>(() => new Set())

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
      start_at?: string
      end_at?: string
      location?: string
      requirements?: ShootRequirementInput[]
    }) =>
      callApi('/shoots', {
        method: 'POST',
        body: createShootRequest.parse({
          project_id: projectId,
          name: input.name,
          ...(input.shoot_date ? { shoot_date: input.shoot_date } : {}),
          ...(input.start_at ? { start_at: input.start_at } : {}),
          ...(input.end_at ? { end_at: input.end_at } : {}),
          ...(input.location ? { location: input.location } : {}),
          ...(input.requirements?.length ? { requirements: input.requirements } : {}),
          status: 'planned',
        }),
        responseSchema: shootListItem.pick({ id: true }).passthrough(),
      }),
    onSuccess: (_d, v) => {
      toast.success(`${v.name} added`)
      setAddOpen(false)
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

  // The first day still short of people -- or, with none short, the first day.
  const focusId = useMemo(() => {
    if (!focusAssign || !data || !slots.data) return null
    const short = data.find((s) => {
      if (s.status === 'cancelled') return false
      const p = shootProgress(requirementFill(s, slots.data.filter((x) => x.shoot_id === s.id && isLive(x))))
      return p.required === 0 || p.assigned < p.required
    })
    return (short ?? data[0])?.id ?? null
  }, [focusAssign, data, slots.data])

  const hasShoots = (data?.length ?? 0) > 0
  const chipsOpen = canEdit && !isLoading && (!hasShoots || addOpen)

  return (
    <div className="mt-4 flex flex-col gap-3">
      {/* One slim row, nothing else above the days: add a day, or book one
          person across many days. */}
      {canEdit && hasShoots && (
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <Button size="sm" variant={addOpen ? 'outline' : 'default'} onClick={() => setAddOpen((v) => !v)} aria-expanded={addOpen}>
            <Plus /> Add event
          </Button>
          {(data?.length ?? 0) > 1 && (
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
              <Users /> Bulk assign
            </Button>
          )}
        </div>
      )}
      {bulkOpen && <BulkAssignDialog projectId={projectId} onClose={() => setBulkOpen(false)} />}

      {chipsOpen && (
        <section aria-labelledby="add-events" className="rounded-xl border border-border bg-card p-4">
          <h2 id="add-events" className="text-base font-bold tracking-tight">Add your events</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {chips.map((name) => (
              <Button
                key={name}
                variant="outline"
                className="h-10 gap-2 border-primary/30 bg-primary/[0.04] px-3 text-sm font-medium hover:border-primary hover:bg-primary/10"
                disabled={create.isPending}
                onClick={() => {
                  setPending(name)
                  create.mutate(
                    { name, shoot_date: todayISO() },
                    { onSuccess: (made) => setPlaceholderDates((d) => new Set(d).add(made.id)) },
                  )
                }}
              >
                <Plus className="size-4 text-primary" />
                <EventIcon name={name} />
                {pending === name ? 'Adding…' : name}
              </Button>
            ))}
            <Button className="h-10" onClick={() => setCustomOpen(true)} disabled={create.isPending}>
              <Plus /> Add another function
            </Button>
            {/* A preset used to be applicable only in the create-project wizard,
                so a studio could save the shape of its wedding day and then
                never reach it again. */}
            {(presets.data ?? []).length > 0 && (
              <Select
                value=""
                className="h-10 w-52"
                aria-label="Add a saved set of functions"
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
                <option value="">Add a set of functions…</option>
                {(presets.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </section>
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
        !canEdit && <EmptyState title="No functions added yet" />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((s) => (
            <ShootPlanner
              key={s.id}
              shoot={s}
              focus={s.id === focusId}
              onFocused={onFocused}
              canEdit={canEdit}
              dateIsPlaceholder={placeholderDates.has(s.id) && s.shoot_date === todayISO()}
              slots={(slots.data ?? []).filter((x) => x.shoot_id === s.id)}
              allSlots={slots.data ?? []}
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
  allSlots,
  records,
  dateIsPlaceholder = false,
  focus = false,
  onFocused,
}: {
  shoot: ShootListItem
  canEdit: boolean
  slots: TeamSlot[]
  /** Every booking in the studio, for "also booked elsewhere that day". */
  allSlots: TeamSlot[]
  records: DataRecord[]
  dateIsPlaceholder?: boolean
  focus?: boolean
  onFocused?: (() => void) | undefined
}) {
  // "Book the team" lands here: bring this day into view and mark it for a moment.
  const cardRef = useRef<HTMLDivElement>(null)
  const [marked, setMarked] = useState(false)
  useEffect(() => {
    if (!focus) return
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setMarked(true)
    onFocused?.()
    const t = window.setTimeout(() => setMarked(false), 2500)
    return () => window.clearTimeout(t)
  }, [focus])
  const update = useUpdateShoot()
  const del = useDeleteShoot()
  const services = useServices()
  const release = useReleaseSlot()
  const confirm = useConfirm()
  /** Open the assign desk; a requirement name focuses it on that role. */
  const [assign, setAssign] = useState<{ requirement?: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [addingReq, setAddingReq] = useState(false)
  const [crewData, setCrewData] = useState(false)

  const live = slots.filter(isLive)
  // Crew terms, for studios that use them: each person's latest send.
  const planAccess = useAccess()
  const usesTerms = canEdit && planAccess.hasModule('team_terms')
  const termSends = useTeamTermsSends(usesTerms && live.length > 0 ? shoot.id : null)
  const termsFor = (userId: string | null): TeamTermsSend | null | undefined => {
    if (!usesTerms || !termSends.data) return undefined
    return termSends.data.find((t) => t.user_id === userId) ?? null
  }
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
  /** Booked, needing data, nothing recorded yet. */
  const owing = live.filter((sl) => !optedOut(sl) && !recordForSlot(sl, records))

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
  const hours = shootHours(shoot)
  const href = mapHref(shoot.map_link)
  const staffed = progress.required > 0 && progress.assigned >= progress.required
  // Before the day there are no cards to chase, so data stays out of sight.
  const dayPassed = !!shoot.shoot_date && shoot.shoot_date <= new Date().toLocaleDateString('en-CA')

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
    <Card
      ref={cardRef}
      className={cn(
        'scroll-mt-4 overflow-hidden transition-shadow',
        // Green only when every seat is filled; otherwise a plain card.
        staffed && 'border-success/40 border-t-4 border-t-success bg-success/[0.06]',
        marked && 'ring-2 ring-primary ring-offset-2',
      )}
    >
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
              <EventTile name={shoot.name} size="sm" />
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
              {shoot.shoot_date &&
                (dateIsPlaceholder ? (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="rounded-full border border-tone-amber/60 bg-tone-amber-soft px-2 py-0.5 font-medium text-tone-amber hover:border-tone-amber"
                  >
                    Date: today · tap to set the real day
                  </button>
                ) : (
                  <span>{shoot.shoot_date}</span>
                ))}
              {/* The hours the day runs, or the one amber ask when nobody has
                  said yet: the team cannot be planned without them. */}
              {start && hours ? (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {start}–{end} · {Number.isInteger(hours) ? hours : hours.toFixed(1)} h
                </span>
              ) : shoot.status !== 'cancelled' && shoot.status !== 'completed' && canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 rounded-full border border-tone-amber/60 bg-tone-amber-soft px-2 py-0.5 font-medium text-tone-amber hover:border-tone-amber"
                >
                  <Clock className="size-3" />
                  {start ? `${start} · set the duration` : 'Set start time & duration'}
                </button>
              ) : start ? (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {start}
                </span>
              ) : null}
              {shoot.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3" />
                  {shoot.location}
                </span>
              )}
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  Map <ExternalLink className="size-3" />
                </a>
              ) : (
                shoot.map_link && (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3" />
                    <span className="select-all">{shoot.map_link}</span>
                  </span>
                )
              )}
              <span className="flex items-center gap-1">
                <Users className="size-3" />
                {progress.assigned}/{progress.required} assigned
              </span>
              {/* Cards only exist once the day has been shot. */}
              {dayPassed && dataTally.needed > 0 && (
                <span className="flex items-center gap-1">
                  <Database className="size-3" /> Data {dataTally.done}/{dataTally.needed}
                </span>
              )}
              {canEdit && dayPassed && owing.length > 1 && (
                <button type="button" onClick={() => setCrewData(true)} className="font-medium text-primary hover:underline">
                  Record everyone’s cards
                </button>
              )}
            </div>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Solid, first: the owner could not see it as an outline. It
                  pulses when the journey ("Book the team") brought them here. */}
              <Button size="sm" className={marked && shoot.requirements.length > 0 ? 'ipc-nudge' : undefined} onClick={() => setAssign({})} disabled={shoot.requirements.length === 0}>
                <UserPlus /> Assign team
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddingReq(true)}>
                <Plus /> Add who this day needs
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} aria-label={`Edit ${shoot.name}`}>
                <Pencil /> Edit
              </Button>
              {/* Save this day's shape (who it needs, how long) for the next
                  wedding; it appears under "Add a set of functions…". */}
              <SavePresetButton
                kind="shoot"
                defaultName={shoot.name}
                label="Save as preset"
                disabled={shoot.requirements.length === 0}
                disabledHint="Add who this day needs first"
                payload={{ requirements: asInput(), internal_work: [], duration_hours: hours || null }}
              />
              <Button size="sm" variant="ghost" asChild>
                <Link to="/shoots/$shootId" params={{ shootId: shoot.id }}>
                  Open this shoot
                </Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
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
              <span>Team assigned</span>
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
                  progress.pct === 100 ? 'bg-success' : 'bg-primary/40',
                )}
                style={{ width: `${progress.pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Only while the day has no roles: after that, "Add who this day
            needs" opens the same chips, and the card stays short. */}
        {canEdit && shoot.requirements.length === 0 && roleChips.length > 0 && (
          <div className="mt-3 rounded-md border border-border bg-muted/20 p-2.5">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <Users className="size-4 text-primary" /> Who this day needs
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {roleChips.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={update.isPending}
                  onClick={() => setRequirements([...asInput(), { name, quantity: 1 }])}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <Plus className="size-3.5" aria-hidden /> {name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {shoot.requirements.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              Nobody planned for this day yet. Tap a role above, then assign your team.
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
                    'rounded-md border p-3',
                    // A filled role is plainly green, not a hint of it.
                    full ? 'border-l-4 border-success/50 border-l-success bg-success/15' : 'border-border bg-card',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <RoleTile name={r.name} size="sm" />
                    <span className="text-sm font-semibold">{r.name}</span>
                    {full ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                        <Check className="size-3" aria-hidden /> {r.assigned}/{r.required}
                      </span>
                    ) : (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {r.assigned} of {r.required}
                      </span>
                    )}
                    {dayPassed &&
                      on.length > 0 &&
                      (() => {
                        const t = dataCounts(on, records)
                        if (t.needed === 0) return null
                        return (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                              t.done >= t.needed ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
                            )}
                          >
                            Data {t.done}/{t.needed}
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
                            className="text-muted-foreground hover:text-destructive"
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
                    <p className="mt-2 text-xs text-muted-foreground">Nobody yet · tap Assign team</p>
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
                          daySlots={allSlots}
                          terms={termsFor(sl.user_id)}
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
        {crewData && <CrewDataDialog projectId={shoot.project_id} shoot={shoot} slots={owing} onClose={() => setCrewData(false)} />}
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
      <DialogContent title="Who does this day need?" description="Tap the roles, and say how many of each.">
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
  // Day, start and hours in the studio's own clock (the stored instants are
  // UTC; reading them back as text used to shift every save by 5½ hours).
  const [when, setWhen] = useState<WhenFields>(() => ({ ...whenOfShoot(shoot), date: shoot.shoot_date ?? whenOfShoot(shoot).date }))
  const [location, setLocation] = useState(shoot.location ?? '')
  const [mapLink, setMapLink] = useState(shoot.map_link ?? '')
  const [status, setStatus] = useState<ShootStatus>(shoot.status)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`project-shoot:${shoot.id}`, { name, when, location, mapLink, status }, (v) => {
    setName(v.name)
    if (v.when && typeof v.when === 'object') setWhen({ date: v.when.date ?? '', time: v.when.time ?? '', hours: typeof v.when.hours === 'number' ? v.when.hours : null })
    setLocation(v.location)
    setMapLink(v.mapLink)
    setStatus(v.status)
  })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Edit this function" description="The day, the hours, and where everyone is going.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <ShootWhenFields value={when} onChange={setWhen} idPrefix="edit" />
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
            <Label htmlFor="edit-loc">Venue</Label>
            <Input id="edit-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-map">Map link</Label>
            <Input
              id="edit-map"
              value={mapLink}
              onChange={(e) => setMapLink(e.target.value)}
              placeholder="Paste the map link"
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
                      ...whenToPatch(when),
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
  onCreate: (v: { name: string; shoot_date?: string; start_at?: string; end_at?: string; location?: string }, saved: () => void) => void
}) {
  const [name, setName] = useState('')
  const [when, setWhen] = useState<WhenFields>({ date: todayISO(), time: '', hours: null })
  const [location, setLocation] = useState('')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`project-shoot:new:${projectId}`, { name, when, location }, (v) => {
    setName(v.name)
    if (v.when && typeof v.when === 'object') setWhen({ date: v.when.date ?? '', time: v.when.time ?? '', hours: typeof v.when.hours === 'number' ? v.when.hours : null })
    setLocation(v.location)
  })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Add a function" description="Its name, when it runs, and the venue.">
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
          <ShootWhenFields value={when} onChange={setWhen} idPrefix="shoot" compact />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shoot-loc">Venue</Label>
            <Input
              id="shoot-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Taj Lands End, Mumbai"
            />
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
                    ...(() => {
                      const w = whenToPatch(when)
                      return {
                        ...(w.shoot_date ? { shoot_date: w.shoot_date } : {}),
                        ...(w.start_at ? { start_at: w.start_at } : {}),
                        ...(w.end_at ? { end_at: w.end_at } : {}),
                      }
                    })(),
                    ...(location.trim() ? { location: location.trim() } : {}),
                  },
                  draft.clear,
                )
              }
            >
              {busy ? 'Adding…' : 'Add function'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
