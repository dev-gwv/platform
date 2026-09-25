import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Plus,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ShootListItem, SlotCostStatus, TeamMember, TeamSlot } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { ApiError } from '@/shared/api/client'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { Avatar } from '@/shared/ui/avatar'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import {
  useBookSlot,
  useBookSlots,
  useMembers,
  useReleaseSlot,
  useSlots,
  useUpdateSlot,
} from '@/features/allocation/api'
import {
  candidatesFor,
  defaultWindowFields,
  fieldsOfSlot,
  hoursLabel,
  isLive,
  payBasisLabel,
  requirementFill,
  shootProgress,
  suggestedPayout,
  windowOf,
  type Candidate,
  type RequirementFill,
} from './assign'
import { QuickAddMemberDialog } from './QuickAddMemberDialog'

/**
 * "Assign team" for one shoot day -- the old platform's allocation desk.
 *
 * The first version here was a bare Who / From / To / Cost form per role: no
 * idea who was free, who suited the role, how full the day already was, or
 * what the person is normally paid, and one person at a time only. This puts
 * the whole day in front of the planner:
 *
 *  - how far the day is staffed, and which requirements still have seats;
 *  - who holds each seat, with Change and Remove;
 *  - a picker that sorts people who fit the role first, and says why anyone
 *    who cannot take it cannot (booked elsewhere at that time, or already on
 *    this role) instead of silently hiding them;
 *  - payout status, amount (pre-filled from a freelancer's saved rate) and an
 *    internal note, set with the booking rather than in a second trip;
 *  - "Many at once": pick people for every open requirement in one screen and
 *    book them together.
 */
export function AssignTeamDialog({
  shoot,
  initialRequirement,
  onClose,
}: {
  shoot: ShootListItem
  initialRequirement?: string | undefined
  onClose: () => void
}) {
  const members = useMembers()
  const slots = useSlots()
  const all = slots.data ?? []
  const onShoot = useMemo(() => all.filter((s) => s.shoot_id === shoot.id && isLive(s)), [all, shoot.id])
  const fill = useMemo(() => requirementFill(shoot, onShoot), [shoot, onShoot])
  const progress = shootProgress(fill)
  const [tab, setTab] = useState<'one' | 'many'>('one')

  const loading = members.isLoading || slots.isLoading

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-3xl"
        title="Assign team to shoot"
        description="Assigned people are booked in Team Booking straight away. Anyone already out at that time is blocked."
      >
        <div>
          <DaySummary shoot={shoot} progress={progress} />

          {shoot.requirements.length === 0 ? (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              Add at least one requirement to this shoot (for example Candid Photographer or Drone Operator)
              before assigning a team.
            </p>
          ) : loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading the team…
            </div>
          ) : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'one' | 'many')} className="mt-3">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="one">
                  <UserPlus className="mr-1.5 size-4" /> One by one
                </TabsTrigger>
                <TabsTrigger value="many">
                  <Users className="mr-1.5 size-4" /> Many at once (bulk)
                </TabsTrigger>
              </TabsList>
              <TabsContent value="one" className="mt-3">
                <AssignOne
                  shoot={shoot}
                  fill={fill}
                  members={members.data ?? []}
                  slots={all}
                  onShoot={onShoot}
                  initialRequirement={initialRequirement}
                  onClose={onClose}
                />
              </TabsContent>
              <TabsContent value="many" className="mt-3">
                <AssignMany
                  shoot={shoot}
                  fill={fill}
                  members={members.data ?? []}
                  slots={all}
                  onDone={() => setTab('one')}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DaySummary({ shoot, progress }: { shoot: ShootListItem; progress: ReturnType<typeof shootProgress> }) {
  const bar = progress.pct === 100 ? 'bg-success' : progress.pct > 0 ? 'bg-warning' : 'bg-destructive'
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{shoot.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {shoot.shoot_date && <span>{shoot.shoot_date}</span>}
            {shoot.start_at && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {new Date(shoot.start_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {shoot.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {shoot.location}
              </span>
            )}
          </p>
        </div>
        {progress.required > 0 && (
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums">
              {progress.assigned}/{progress.required} assigned
            </p>
            <p className="text-[11px] text-muted-foreground">{progress.pct}% allocated</p>
          </div>
        )}
      </div>
      {progress.required > 0 && (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progress.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Team allocated"
        >
          <div className={cn('h-full rounded-full transition-[width] duration-500', bar)} style={{ width: `${progress.pct}%` }} />
        </div>
      )}
    </div>
  )
}

const COST_STATUS: { value: SlotCostStatus; label: string }[] = [
  { value: 'tentative', label: 'Tentative' },
  { value: 'final', label: 'Final' },
  { value: 'not_decided', label: 'Not decided' },
]

/** A 409 from the overlap guard, said the way the planner thinks about it. */
function bookingError(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) return 'This person is already booked for another assignment at this time.'
  return e instanceof Error ? e.message : 'We could not book this.'
}

// ── One by one ──────────────────────────────────────────────────

function AssignOne({
  shoot,
  fill,
  members,
  slots,
  onShoot,
  initialRequirement,
  onClose,
}: {
  shoot: ShootListItem
  fill: RequirementFill[]
  members: TeamMember[]
  slots: TeamSlot[]
  onShoot: TeamSlot[]
  initialRequirement?: string | undefined
  onClose: () => void
}) {
  const { session } = useAuth()
  const book = useBookSlot()
  const update = useUpdateSlot()
  const release = useReleaseSlot()
  const confirm = useConfirm()

  const pending = fill.filter((r) => r.open > 0)
  const full = fill.filter((r) => r.open === 0)
  const start = defaultWindowFields(shoot)

  const [requirement, setRequirement] = useState(
    () => fill.find((r) => r.name === initialRequirement)?.name ?? pending[0]?.name ?? fill[0]?.name ?? '',
  )
  const [date, setDate] = useState(start.date)
  const [time, setTime] = useState(start.time)
  const [hours, setHours] = useState(start.hours)
  const [memberId, setMemberId] = useState('')
  const [costStatus, setCostStatus] = useState<SlotCostStatus>('tentative')
  const [cost, setCost] = useState('')
  const [costTouched, setCostTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [replacing, setReplacing] = useState<{ slot: TeamSlot; name: string } | null>(null)
  const [justAssigned, setJustAssigned] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState(false)
  // What was typed survives a refresh or a closed tab until it is saved. Only
  // a typed payout or note makes it worth keeping; a pick alone is one click.
  const draft = useFormDraft(
    `assign-team:${shoot.id}`,
    { requirement, date, time, hours, memberId, costStatus, cost, costTouched, notes },
    (v) => {
      setRequirement(v.requirement)
      setDate(v.date)
      setTime(v.time)
      setHours(v.hours)
      setMemberId(v.memberId)
      setCostStatus(v.costStatus)
      setCost(v.cost)
      setCostTouched(v.costTouched)
      setNotes(v.notes)
    },
    { isBlank: (v) => !v.costTouched && !v.notes.trim() },
  )

  const slotWindow = windowOf(date, time, hours)
  const current = fill.find((r) => r.name === requirement)
  const openSeats = current?.open ?? 0

  const candidates = useMemo(
    () =>
      candidatesFor({
        members,
        requirement,
        window: slotWindow,
        shootId: shoot.id,
        slots,
        ignoreSlotId: replacing?.slot.id,
      }),
    [members, requirement, slotWindow?.start, slotWindow?.end, shoot.id, slots, replacing?.slot.id],
  )
  const picked = members.find((m) => m.user_id === memberId) ?? null
  const pickedCandidate = candidates.find((c) => c.member.user_id === memberId)

  // A pick that stops being possible (the time changed under it) is dropped
  // rather than left selected and refused on submit.
  useEffect(() => {
    if (pickedCandidate && pickedCandidate.availability.state !== 'free') setMemberId('')
  }, [pickedCandidate])

  // A freelancer's saved rate fills the payout, until the planner types one.
  useEffect(() => {
    if (!picked || costTouched) return
    const rate = suggestedPayout(picked)
    setCost(rate != null ? String(rate) : '')
  }, [picked, costTouched])

  // A requirement that fills up hands over to the next one that has seats.
  useEffect(() => {
    if (replacing) return
    if (current && current.open === 0 && pending.length > 0) setRequirement(pending[0]!.name)
  }, [current, pending, replacing])

  const onRole = onShoot.filter((s) => (s.service_name ?? '').toLowerCase() === requirement.toLowerCase())
  const elsewhere = onShoot.filter((s) => (s.service_name ?? '').toLowerCase() !== requirement.toLowerCase())

  const q = search.trim().toLowerCase()
  const shown = candidates.filter(
    (c) =>
      !q ||
      c.member.name.toLowerCase().includes(q) ||
      c.member.role_names.some((r) => r.toLowerCase().includes(q)) ||
      (c.member.phone ?? '').includes(q),
  )

  function reset() {
    setMemberId('')
    setCost('')
    setCostTouched(false)
    setNotes('')
    setCostStatus('tentative')
  }

  async function onAssign() {
    if (!picked || !slotWindow || !requirement) return
    const amount = cost.trim() === '' ? undefined : Number(cost)
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      toast.error('Payout must be a positive number.')
      return
    }
    try {
      await book.mutateAsync({
        user_id: picked.user_id,
        shoot_id: shoot.id,
        service_name: requirement,
        start_at: slotWindow.start,
        end_at: slotWindow.end,
        ...(amount !== undefined && costStatus !== 'not_decided' ? { estimated_cost: amount } : {}),
        cost_status: costStatus,
        ...(notes.trim() ? { cost_notes: notes.trim() } : {}),
      })
      draft.clear()
      setJustAssigned(`${picked.name} is booked as ${requirement}.`)
      reset()
    } catch (e) {
      toast.error(bookingError(e))
    }
  }

  async function onReplace() {
    if (!replacing || !picked) return
    try {
      await update.mutateAsync({ id: replacing.slot.id, patch: { user_id: picked.user_id } })
      setJustAssigned(`${picked.name} replaces ${replacing.name} as ${replacing.slot.service_name ?? requirement}.`)
      setReplacing(null)
      reset()
    } catch (e) {
      toast.error(bookingError(e))
    }
  }

  function startReplace(slot: TeamSlot) {
    const f = fieldsOfSlot(slot)
    setReplacing({ slot, name: slot.user_name ?? 'this person' })
    if (slot.service_name) setRequirement(slot.service_name)
    setDate(f.date)
    setTime(f.time)
    setHours(f.hours)
    setMemberId('')
    setJustAssigned(null)
  }

  async function onRemove(slot: TeamSlot) {
    const yes = await confirm({
      title: `Remove ${slot.user_name ?? 'this person'} from ${shoot.name}?`,
      description: 'Their seat opens again. The booking stays in the history.',
      destructive: true,
      confirmLabel: 'Remove',
    })
    if (!yes) return
    release.mutate(slot.id, { onSuccess: () => toast.success(`${slot.user_name ?? 'Member'} removed.`) })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Which requirements still need people -- the planner's to-do list. */}
      <section className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending requirements</p>
          <p className="text-[11px] text-muted-foreground">
            {pending.length === 0
              ? 'All requirements filled'
              : `${pending.length} requirement${pending.length === 1 ? '' : 's'} need people`}
          </p>
        </div>
        {pending.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-2 text-xs text-success">
            <CheckCircle2 className="size-4" /> Every requirement on this day is fully staffed.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pending.map((r) => {
              const active = r.name === requirement
              return (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => {
                    setRequirement(r.name)
                    setReplacing(null)
                  }}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-tone-amber/40 bg-tone-amber-soft text-tone-amber hover:border-tone-amber',
                  )}
                >
                  <AlertCircle className="size-3" aria-hidden />
                  {r.name}
                  <span className={cn('ml-0.5 rounded-full px-1.5 text-[10px] font-semibold', active ? 'bg-card/25' : 'bg-card/70')}>
                    {r.open} left
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {full.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {full.map((r) => (
              <button
                key={r.name}
                type="button"
                onClick={() => setRequirement(r.name)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  r.name === requirement
                    ? 'border-success bg-success text-card'
                    : 'border-success/40 bg-success/10 text-success',
                )}
              >
                <CheckCircle2 className="size-3" aria-hidden /> {r.name} · {r.assigned}/{r.required}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Who already holds this requirement's seats. */}
      <section>
        <p className="text-xs font-semibold">
          On “{requirement}” <span className="font-normal text-muted-foreground">({onRole.length}/{current?.required ?? 0})</span>
        </p>
        {onRole.length === 0 ? (
          <p className="mt-1 rounded-md border border-dashed border-border bg-muted/20 p-2 text-[11px] text-muted-foreground">
            Nobody on this requirement yet.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {onRole.map((s) => (
              <BookedRow key={s.id} slot={s} onChange={() => startReplace(s)} onRemove={() => void onRemove(s)} busy={release.isPending} />
            ))}
          </ul>
        )}
        {elsewhere.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
              Everyone else on this shoot ({elsewhere.length})
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {elsewhere.map((s) => (
                <BookedRow
                  key={s.id}
                  slot={s}
                  showRole
                  onChange={() => startReplace(s)}
                  onRemove={() => void onRemove(s)}
                  busy={release.isPending}
                />
              ))}
            </ul>
          </details>
        )}
      </section>

      {replacing && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
          <div>
            <p className="font-semibold text-primary">Replacing {replacing.name}</p>
            <p className="text-[11px] text-muted-foreground">
              Pick who takes their place below. The role, hours and payout stay as they are.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setReplacing(null)}>
            Cancel
          </Button>
        </div>
      )}

      {/* The booking itself. */}
      <section className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {replacing ? 'Replacement' : 'Add team member'}
        </p>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="assign-req" className="text-xs">
              Requirement
            </Label>
            <Select
              id="assign-req"
              value={requirement}
              disabled={!!replacing}
              onChange={(e) => setRequirement(e.target.value)}
            >
              {fill.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} — {r.open > 0 ? `${r.open} slot${r.open === 1 ? '' : 's'} left` : 'full'}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4.5rem] gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-date" className="text-xs">
                Date
              </Label>
              <Input id="assign-date" type="date" value={date} disabled={!!replacing} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-time" className="text-xs">
                Start
              </Label>
              <Input id="assign-time" type="time" value={time} disabled={!!replacing} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-hours" className="text-xs">
                Hours
              </Label>
              <Input
                id="assign-hours"
                type="number"
                min={0.5}
                step={0.5}
                value={hours}
                disabled={!!replacing}
                onChange={(e) => setHours(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="assign-search" className="text-xs">
              Team member
            </Label>
            {session?.is_owner && (
              <button
                type="button"
                onClick={() => setQuickAdd(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <Plus className="size-3" /> Add team member
              </button>
            )}
          </div>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="assign-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, role or phone"
              className="pl-8"
            />
          </div>
          <MemberPicker
            candidates={shown}
            selected={memberId}
            onSelect={(id) => {
              setMemberId(id)
              setJustAssigned(null)
            }}
            requirement={requirement}
            hasWindow={!!slotWindow}
          />
          {picked && (
            <p className="mt-1 text-[11px] text-success">
              {payBasisLabel(picked) ?? 'No pay basis saved for this person — add the payout below.'}
              {suggestedPayout(picked) != null && !costTouched ? ' — pre-filled below' : ''}
            </p>
          )}
        </div>

        {!replacing && (
          <div className="mt-3 grid gap-3 rounded-md border border-border bg-muted/30 p-2.5 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-cost-status" className="text-xs">
                Payout status
              </Label>
              <Select
                id="assign-cost-status"
                value={costStatus}
                onChange={(e) => setCostStatus(e.target.value as SlotCostStatus)}
              >
                {COST_STATUS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-cost" className="text-xs">
                Estimated payout (₹)
              </Label>
              <Input
                id="assign-cost"
                inputMode="decimal"
                placeholder="e.g. 12000"
                value={cost}
                disabled={costStatus === 'not_decided'}
                onChange={(e) => {
                  setCostTouched(true)
                  setCost(e.target.value.replace(/[^\d.]/g, ''))
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assign-notes" className="text-xs">
                Notes (internal)
              </Label>
              <Input id="assign-notes" placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <p className="text-[11px] text-muted-foreground sm:col-span-3">
              This is the project’s direct cost for this booking. Team members never see it.
            </p>
          </div>
        )}

        {justAssigned && (
          <p className="mt-3 flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-2 text-xs text-success">
            <CheckCircle2 className="size-4 shrink-0" /> {justAssigned}
          </p>
        )}
      </section>

      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
        {replacing ? (
          <Button disabled={!picked || update.isPending} onClick={() => void onReplace()}>
            {update.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Replace team member
          </Button>
        ) : (
          <Button
            disabled={!picked || !slotWindow || openSeats <= 0 || book.isPending}
            onClick={() => void onAssign()}
            title={openSeats <= 0 ? 'This requirement is fully staffed' : undefined}
          >
            {book.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Assign &amp; book slot
          </Button>
        )}
      </DialogFooter>

      {quickAdd && (
        <QuickAddMemberDialog
          requirement={requirement}
          onClose={() => setQuickAdd(false)}
          onCreated={(id) => {
            setQuickAdd(false)
            setMemberId(id)
          }}
        />
      )}
    </div>
  )
}

function BookedRow({
  slot,
  showRole,
  onChange,
  onRemove,
  busy,
}: {
  slot: TeamSlot
  showRole?: boolean
  onChange: () => void
  onRemove: () => void
  busy: boolean
}) {
  const payout = slot.final_cost ?? slot.estimated_cost
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 text-sm">
      <Avatar name={slot.user_name ?? '?'} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{slot.user_name ?? 'Unknown'}</p>
        <p className="text-[11px] text-muted-foreground">
          {showRole && slot.service_name ? `${slot.service_name} · ` : ''}
          {hoursLabel(slot)} ·{' '}
          {payout != null ? `${formatINR(payout)} · ${slot.cost_status.replace('_', ' ')}` : 'Payout not added'}
        </p>
      </div>
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onChange} disabled={busy}>
        Change
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={onRemove} disabled={busy}>
        <X className="size-3.5" /> Remove
      </Button>
    </li>
  )
}

/** Why someone cannot take this seat, in a few words. */
function unavailableReason(c: Candidate): string | null {
  if (c.availability.state === 'on_role') return 'Already on this role'
  if (c.availability.state === 'busy') {
    const s = c.availability.slot
    return `Booked ${hoursLabel(s)}${s.service_name ? ` · ${s.service_name}` : ''}`
  }
  return null
}

function MemberPicker({
  candidates,
  selected,
  onSelect,
  requirement,
  hasWindow,
}: {
  candidates: Candidate[]
  selected: string
  onSelect: (id: string) => void
  requirement: string
  hasWindow: boolean
}) {
  const free = candidates.filter((c) => c.availability.state === 'free')
  const blocked = candidates.filter((c) => c.availability.state !== 'free')
  const [showBlocked, setShowBlocked] = useState(false)

  if (!hasWindow) {
    return <p className="mt-2 text-[11px] text-muted-foreground">Set the date, start time and hours to see who is free.</p>
  }

  return (
    <div className="mt-2 rounded-md border border-border">
      {free.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">
          Nobody is free for this time. Change the hours, or add a new team member.
        </p>
      ) : (
        <ul role="listbox" aria-label={`People for ${requirement}`} className="max-h-60 overflow-y-auto p-1">
          {free.map((c) => (
            <li key={c.member.user_id}>
              <button
                type="button"
                role="option"
                aria-selected={selected === c.member.user_id}
                onClick={() => onSelect(c.member.user_id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  selected === c.member.user_id ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted',
                )}
              >
                <Avatar name={c.member.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.member.name}</span>
                  {c.member.role_names.length > 0 && (
                    <span className="block truncate text-[11px] text-muted-foreground">{c.member.role_names.join(', ')}</span>
                  )}
                </span>
                {c.member.engagement_type === 'freelancer' && (
                  <span className="rounded-full border border-tone-violet/30 bg-tone-violet-soft px-1.5 text-[10px] font-medium text-tone-violet">
                    Freelancer
                  </span>
                )}
                {c.match && (
                  <span className="rounded-full border border-success/40 bg-success/10 px-1.5 text-[10px] font-medium text-success">
                    Role match
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {blocked.length > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setShowBlocked((v) => !v)}
            className="w-full px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showBlocked ? 'Hide' : 'Show'} {blocked.length} not available at this time
          </button>
          {showBlocked && (
            <ul className="max-h-40 overflow-y-auto px-1 pb-1">
              {blocked.map((c) => (
                <li key={c.member.user_id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm opacity-70">
                  <Avatar name={c.member.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{c.member.name}</span>
                  <span className="text-[11px] text-destructive">{unavailableReason(c)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── Many at once ────────────────────────────────────────────────

/**
 * Staff the whole day in one go: every requirement that still has seats, each
 * with the people free at that time (role matches first), tick who goes where
 * and book them together. One person can only be ticked once -- a person
 * cannot be two roles at the same hour.
 */
function AssignMany({
  shoot,
  fill,
  members,
  slots,
  onDone,
}: {
  shoot: ShootListItem
  fill: RequirementFill[]
  members: TeamMember[]
  slots: TeamSlot[]
  onDone: () => void
}) {
  const bookMany = useBookSlots()
  const start = defaultWindowFields(shoot)
  const [date, setDate] = useState(start.date)
  const [time, setTime] = useState(start.time)
  const [hours, setHours] = useState(start.hours)
  const [costStatus, setCostStatus] = useState<SlotCostStatus>('tentative')
  const [search, setSearch] = useState('')
  const [matchesOnly, setMatchesOnly] = useState(false)
  /** requirement → picked user ids, in pick order. */
  const [picks, setPicks] = useState<Record<string, string[]>>({})
  /** `${requirement}|${userId}` → payout typed for that person. */
  const [payouts, setPayouts] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState<string[]>([])
  // Picks and payouts for a whole crew survive a refresh or a closed tab until they are booked.
  const draft = useFormDraft(
    `assign-team-many:${shoot.id}`,
    { date, time, hours, costStatus, picks, payouts },
    (v) => {
      setDate(v.date)
      setTime(v.time)
      setHours(v.hours)
      setCostStatus(v.costStatus)
      setPicks(v.picks)
      setPayouts(v.payouts)
    },
    { isBlank: (v) => Object.values(v.picks).every((ids) => ids.length === 0) },
  )

  const slotWindow = windowOf(date, time, hours)
  const pending = fill.filter((r) => r.open > 0)
  const pickedAnywhere = new Map<string, string>()
  for (const [req, ids] of Object.entries(picks)) for (const id of ids) pickedAnywhere.set(id, req)
  const total = Object.values(picks).reduce((n, ids) => n + ids.length, 0)
  const byId = new Map(members.map((m) => [m.user_id, m]))
  const q = search.trim().toLowerCase()

  function toggle(req: string, member: TeamMember, open: number) {
    setFailed([])
    setPicks((prev) => {
      const cur = prev[req] ?? []
      if (cur.includes(member.user_id)) return { ...prev, [req]: cur.filter((x) => x !== member.user_id) }
      if (cur.length >= open) {
        toast.error(`${req} only has ${open} seat${open === 1 ? '' : 's'} left.`)
        return prev
      }
      return { ...prev, [req]: [...cur, member.user_id] }
    })
    const k = `${req}|${member.user_id}`
    setPayouts((prev) => {
      if (k in prev) return prev
      const rate = suggestedPayout(member)
      return { ...prev, [k]: rate != null ? String(rate) : '' }
    })
  }

  async function submit() {
    if (!slotWindow || total === 0) return
    const rows = Object.entries(picks).flatMap(([req, ids]) => ids.map((id) => ({ req, id })))
    const items = rows.map(({ req, id }) => {
      const raw = payouts[`${req}|${id}`]?.trim() ?? ''
      const amount = raw === '' ? undefined : Number(raw)
      return {
        user_id: id,
        shoot_id: shoot.id,
        service_name: req,
        start_at: slotWindow.start,
        end_at: slotWindow.end,
        ...(amount !== undefined && Number.isFinite(amount) && amount >= 0 && costStatus !== 'not_decided'
          ? { estimated_cost: amount }
          : {}),
        cost_status: costStatus,
      }
    })
    try {
      const { results } = await bookMany.mutateAsync(items)
      const ok = results.filter((r) => r.id).length
      const bad = results
        .filter((r) => !r.id)
        .map((r) => {
          const row = rows[r.index]!
          const who = byId.get(row.id)?.name ?? 'Someone'
          return r.error === 'double_booked' ? `${who} (${row.req}) is already booked at this time` : `${who} (${row.req}) could not be booked`
        })
      setFailed(bad)
      if (ok > 0) toast.success(`${ok} ${ok === 1 ? 'person' : 'people'} assigned and booked.`)
      if (bad.length === 0) {
        draft.clear()
        setPicks({})
        setPayouts({})
        onDone()
      } else {
        // Keep only what did not go in, so a retry sends just those.
        const keep = new Set(results.filter((r) => !r.id).map((r) => r.index))
        const next: Record<string, string[]> = {}
        rows.forEach((row, i) => {
          if (keep.has(i)) next[row.req] = [...(next[row.req] ?? []), row.id]
        })
        setPicks(next)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not book the team.')
    }
  }

  if (pending.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
        <CheckCircle2 className="size-4" /> Every requirement on this day is fully staffed. Use “One by one” to change
        anyone.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_5rem_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-date" className="text-xs">
            Date
          </Label>
          <Input id="bulk-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-time" className="text-xs">
            Start
          </Label>
          <Input id="bulk-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-hours" className="text-xs">
            Hours
          </Label>
          <Input
            id="bulk-hours"
            type="number"
            min={0.5}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) || 0)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-cost-status" className="text-xs">
            Payout status
          </Label>
          <Select id="bulk-cost-status" value={costStatus} onChange={(e) => setCostStatus(e.target.value as SlotCostStatus)}>
            {COST_STATUS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-[11px] text-muted-foreground sm:col-span-4">
          Everyone ticked below is booked for these hours. Payouts are pre-filled from each freelancer’s saved rate.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people"
            className="pl-8"
            aria-label="Search people"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={matchesOnly} onChange={(e) => setMatchesOnly(e.target.checked)} />
          Only people whose role fits
        </label>
      </div>

      {!slotWindow ? (
        <p className="text-sm text-muted-foreground">Set the date, start time and hours to see who is free.</p>
      ) : (
        pending.map((r) => {
          const chosen = picks[r.name] ?? []
          const cands = candidatesFor({ members, requirement: r.name, window: slotWindow, shootId: shoot.id, slots })
          const free = cands.filter(
            (c) =>
              c.availability.state === 'free' &&
              (!matchesOnly || c.match) &&
              (!q || c.member.name.toLowerCase().includes(q) || c.member.role_names.some((x) => x.toLowerCase().includes(q))),
          )
          const blocked = cands.length - cands.filter((c) => c.availability.state === 'free').length
          return (
            <section key={r.name} className="rounded-lg border border-border">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
                <p className="text-sm font-semibold">
                  {r.name}{' '}
                  <span className="font-normal text-muted-foreground">
                    · {chosen.length}/{r.open} picked
                  </span>
                </p>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    chosen.length >= r.open ? 'bg-success/15 text-success' : 'bg-tone-amber-soft text-tone-amber',
                  )}
                >
                  {r.open - chosen.length > 0 ? `${r.open - chosen.length} seat${r.open - chosen.length === 1 ? '' : 's'} left` : 'All seats picked'}
                </span>
              </header>
              {free.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">Nobody free fits this filter.</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto p-1">
                  {free.map((c) => {
                    const id = c.member.user_id
                    const on = chosen.includes(id)
                    const other = pickedAnywhere.get(id)
                    const lockedElsewhere = !!other && other !== r.name
                    const k = `${r.name}|${id}`
                    return (
                      <li
                        key={id}
                        className={cn(
                          'flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                          on ? 'bg-primary/10' : 'hover:bg-muted',
                          lockedElsewhere && 'opacity-50',
                        )}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={lockedElsewhere}
                            onChange={() => toggle(r.name, c.member, r.open)}
                            aria-label={`${c.member.name} as ${r.name}`}
                          />
                          <Avatar name={c.member.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{c.member.name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {lockedElsewhere ? `Picked for ${other}` : c.member.role_names.join(', ') || '—'}
                            </span>
                          </span>
                          {c.match && (
                            <span className="rounded-full border border-success/40 bg-success/10 px-1.5 text-[10px] font-medium text-success">
                              Role match
                            </span>
                          )}
                        </label>
                        {on && (
                          <Input
                            aria-label={`Payout for ${c.member.name}`}
                            inputMode="decimal"
                            placeholder="Payout ₹"
                            className="h-7 w-28 text-xs"
                            value={payouts[k] ?? ''}
                            disabled={costStatus === 'not_decided'}
                            onChange={(e) => setPayouts((p) => ({ ...p, [k]: e.target.value.replace(/[^\d.]/g, '') }))}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {blocked > 0 && (
                <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                  {blocked} {blocked === 1 ? 'person is' : 'people are'} booked elsewhere at this time or already on this role.
                </p>
              )}
            </section>
          )
        })
      )}

      {failed.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-medium text-destructive">Not booked — still ticked, change the hours or pick someone else:</p>
          <ul className="mt-1 list-disc pl-4">
            {failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <DialogFooter className="sm:justify-between">
        <p className="mr-auto self-center text-xs text-muted-foreground">
          {total === 0 ? 'Tick people to assign them' : `${total} ${total === 1 ? 'person' : 'people'} selected`}
        </p>
        <Button disabled={!slotWindow || total === 0 || bookMany.isPending} onClick={() => void submit()}>
          {bookMany.isPending ? <Loader2 className="animate-spin" /> : <Users />} Assign {total > 0 ? total : ''}{' '}
          {total === 1 ? 'person' : 'people'}
        </Button>
      </DialogFooter>
    </div>
  )
}
