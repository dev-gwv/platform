import { useMemo, useState, type ReactNode } from 'react'
import { Check, Clock, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ShootListItem, SlotCostStatus, TeamMember, TeamSlot } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { Avatar } from '@/shared/ui/avatar'
import { DurationField } from '@/shared/ui/duration-field'
import { cn } from '@/shared/ui/cn'
import { useINR } from '@/shared/money/MoneyMask'
import { useConfirm } from '@/shared/ui/confirm'
import { useBookSlots, useMembers, useReleaseSlot, useSetSlotCost, useSlots, useUpdateSlot } from '@/features/allocation/api'
import { useUpdateShoot } from './api'
import {
  availabilityLine,
  bookingsOn,
  canPick,
  candidatesFor,
  clockRange,
  defaultWindowFields,
  isLive,
  localDay,
  normalizePicks,
  pickedIds,
  rangeLabel,
  requirementFill,
  seatsLeft,
  progressWithPicks,
  withPicks,
  suggestedRate,
  windowFor,
  windowOf,
  type BaseWindow,
  type Candidate,
  type RequirementFill,
  type SeatPick,
  type TimeWindow,
} from './assign'
import { ShootWhenFields, whenToPatch, type WhenFields } from './ShootWhenFields'
import { guestsLabel } from './guests'
import { QuickAddMemberDialog } from './QuickAddMemberDialog'
import { AlsoBookedLine, PersonDayLine } from './PersonDay'
import { useLeave } from '@/features/hr/leave-api'
import { RoleTile } from '@/shared/ui/icon-tile'
import { AssignedNote } from '@/features/team/AssignedNote'
import { CopyTeamBar } from './CopyTeamBar'

/**
 * "Assign team" for one shoot: the roles it needs, who is in each, and an
 * empty seat you tap to choose someone.
 *
 * It used to be two tabs ("One by one" and "Many at once") with about fifteen
 * controls before the first booking: a requirement dropdown, date, start,
 * hours, payout status, amount and notes every time. Almost always the time is
 * the shoot's and the payout is the freelancer's saved rate, so those are now
 * defaults, and picking for one role or five is the same motion: tap the seat,
 * tap a name, then "Book".
 *
 * The rules underneath live in ./assign: only people free at that time are
 * offered, role fits first; a person cannot hold two roles at once; a
 * freelancer's saved rate fills the payout. Each name says, in plain words,
 * what else that person has that day ("Free at this time · also booked 7–9 PM
 * · Sangeet (Mehta Wedding)"), and hovering it shows their whole day -- the
 * travel between two bookings is the planner's judgement, not a setting.
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
  const loading = members.isLoading || slots.isLoading

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl" title="Assign team" description={shootLine(shoot)}>
        {shoot.requirements.length === 0 ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            Add the roles this shoot needs first (for example Candid Photographer), then assign people to them.
          </p>
        ) : loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading the team…
          </div>
        ) : (
          <AssignBoard
            shoot={shoot}
            members={members.data ?? []}
            slots={slots.data ?? []}
            initialRequirement={initialRequirement}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function shootLine(shoot: ShootListItem): string {
  const parts = [shoot.name]
  if (shoot.shoot_date) {
    parts.push(new Date(`${shoot.shoot_date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }))
  }
  if (shoot.start_at && shoot.end_at) parts.push(clockRange(shoot.start_at, shoot.end_at))
  if (shoot.location) parts.push(shoot.location)
  const guests = guestsLabel(shoot.guests)
  if (guests) parts.push(guests)
  return parts.join(' · ')
}

/** Why a pick did not go in, in a few words. */
function failureText(error: string | null): string {
  return error === 'double_booked' ? 'Booked elsewhere at that time' : error === 'no_time' ? 'Set the hours first' : 'Could not be booked'
}

/** A pick's own hours, or the shoot's, for the chip. */
function pickOverride(p: SeatPick): { start?: string; hours?: number } {
  return { ...(p.start ? { start: p.start } : {}), ...(p.hours ? { hours: p.hours } : {}) }
}

function AssignBoard({
  shoot,
  members,
  slots,
  initialRequirement,
  onClose,
}: {
  shoot: ShootListItem
  members: TeamMember[]
  slots: TeamSlot[]
  initialRequirement?: string | undefined
  onClose: () => void
}) {
  const { session } = useAuth()
  const bookMany = useBookSlots()
  const update = useUpdateSlot()
  const release = useReleaseSlot()
  const updateShoot = useUpdateShoot()
  const confirm = useConfirm()
  const leaves = useLeave('team', 'approved').data ?? []

  const onShoot = useMemo(() => slots.filter((s) => s.shoot_id === shoot.id && isLive(s)), [slots, shoot.id])
  const fill = useMemo(() => requirementFill(shoot, onShoot), [shoot, onShoot])

  // The shoot's own day, start and hours are the default for everyone
  // booked here. Without them the dialog asks first -- it never assumes.
  const start = defaultWindowFields(shoot)
  const [when, setWhen] = useState<WhenFields>(start)
  const [showTime, setShowTime] = useState(false)
  /** "Save to shoot" was pressed: the project now carries these hours, even before the list refetches. */
  const [savedToShoot, setSavedToShoot] = useState(false)
  const missingTime = (!shoot.start_at || !shoot.end_at) && !savedToShoot
  /** requirement → people picked for it, not booked yet. */
  const [picks, setPicks] = useState<Record<string, SeatPick[]>>({})
  /** `${requirement}|${userId}` → why that pick did not go in. */
  const [failed, setFailed] = useState<Record<string, string>>({})
  /** The role whose picker is open, and the booking being swapped when it is a "Change person". */
  const [picker, setPicker] = useState<{ role: string; replacing?: TeamSlot } | null>(() => {
    const r = fill.find((f) => f.name === initialRequirement && f.open > 0) ?? null
    return r ? { role: r.name } : null
  })
  const [editing, setEditing] = useState<TeamSlot | null>(null)
  const [quickAdd, setQuickAdd] = useState<string | null>(null)
  /** Who was just booked, for the "they see it on their own login" note. */
  const [justBooked, setJustBooked] = useState<TeamMember[]>([])
  /** Someone was booked in this sitting: Done becomes the next thing to press. */
  const [bookedOnce, setBookedOnce] = useState(false)

  // A half-picked crew survives a refresh or a closed tab until it is booked.
  const draft = useFormDraft(
    `assign-team:${shoot.id}`,
    { when, picks },
    (v) => {
      const w = v.when as Partial<WhenFields> | undefined
      // The shoot's own hours win: a saved draft's hours count only while the
      // shoot has none (they were being typed in here).
      if (missingTime && w && typeof w === 'object') {
        setWhen({ date: w.date ?? start.date, time: w.time ?? start.time, hours: typeof w.hours === 'number' ? w.hours : start.hours })
      }
      setPicks(normalizePicks(v.picks))
    },
    { isBlank: (v) => Object.values(v.picks ?? {}).every((p) => p.length === 0) },
  )

  const base: BaseWindow = when
  const slotWindow = when.hours != null ? windowOf(when.date, when.time, when.hours) : null
  const day = slotWindow ? localDay(slotWindow.start) : when.date
  const left = seatsLeft(fill, picks)
  const taken = pickedIds(picks)
  const byId = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members])
  const total = taken.size
  const finished = bookedOnce && total === 0

  // Roles still needing people first, then the full ones -- the to-do on top.
  const ordered = [...fill].sort((a, b) => Number(a.open === 0) - Number(b.open === 0))

  function pick(role: string, member: TeamMember) {
    const rate = suggestedRate(member, { shootName: shoot.name, hours: when.hours })
    const seat: SeatPick = rate ? { id: member.user_id, payout: String(rate.amount), why: rate.why } : { id: member.user_id, payout: '' }
    const next = { ...picks, [role]: [...(picks[role] ?? []), seat] }
    setPicks(next)
    // Close the list once the role has all the people it needs.
    if ((seatsLeft(fill, next).get(role) ?? 0) === 0) setPicker(null)
  }

  function unpick(role: string, id: string) {
    setPicks((p) => ({ ...p, [role]: (p[role] ?? []).filter((x) => x.id !== id) }))
    setFailed((f) => {
      const { [`${role}|${id}`]: _gone, ...rest } = f
      return rest
    })
  }

  function patchPick(role: string, id: string, patch: { payout?: string; start?: string | undefined; hours?: number | undefined }) {
    setPicks((p) => ({
      ...p,
      [role]: (p[role] ?? []).map((x): SeatPick => {
        if (x.id !== id) return x
        const next: SeatPick = { id: x.id, payout: patch.payout ?? x.payout }
        // A typed payout is the studio's own number, not a usual rate any more.
        if (x.why && patch.payout === undefined) next.why = x.why
        const start = 'start' in patch ? patch.start : x.start
        const hours = 'hours' in patch ? patch.hours : x.hours
        if (start) next.start = start
        if (hours) next.hours = hours
        return next
      }),
    }))
  }

  async function replace(slot: TeamSlot, member: TeamMember) {
    try {
      await update.mutateAsync({ id: slot.id, patch: { user_id: member.user_id } })
      toast.success(`${member.name} is now on ${slot.service_name ?? 'this role'}.`)
      setPicker(null)
      setJustBooked([member])
    } catch (e) {
      toast.error(e instanceof Error && /409|already/i.test(e.message) ? 'They are already booked at this time.' : 'We could not change this.')
    }
  }

  async function changeHours(slot: TeamSlot, w: TimeWindow) {
    try {
      await update.mutateAsync({ id: slot.id, patch: { start_at: w.start, end_at: w.end } })
      toast.success(`${slot.user_name ?? 'They'} now ${rangeLabel(w)}.`)
    } catch (e) {
      toast.error(e instanceof Error && /409|already/i.test(e.message) ? 'They are booked elsewhere at that time.' : 'We could not change the hours.')
    }
  }

  async function remove(slot: TeamSlot) {
    const yes = await confirm({
      title: `Remove ${slot.user_name ?? 'this person'}?`,
      description: 'Their seat opens again.',
      destructive: true,
      confirmLabel: 'Remove',
    })
    if (yes) release.mutate(slot.id, { onSuccess: () => toast.success(`${slot.user_name ?? 'They'} removed.`) })
  }

  function saveToShoot() {
    updateShoot.mutate(
      { id: shoot.id, patch: whenToPatch(when) },
      {
        onSuccess: () => {
          setSavedToShoot(true)
          setShowTime(false)
        },
      },
    )
  }

  async function book() {
    if (total === 0) return
    const rows = Object.entries(picks).flatMap(([role, ps]) => ps.map((p) => ({ role, ...p })))
    const windows = rows.map((r) => windowFor(r, base))
    if (windows.some((w) => !w)) {
      setFailed(Object.fromEntries(rows.filter((_, i) => !windows[i]).map((r) => [`${r.role}|${r.id}`, failureText('no_time')])))
      return
    }
    const items = rows.map((r, i) => {
      const amount = r.payout.trim() === '' ? undefined : Number(r.payout)
      const w = windows[i]!
      return {
        user_id: r.id,
        shoot_id: shoot.id,
        service_name: r.role,
        start_at: w.start,
        end_at: w.end,
        ...(amount !== undefined && Number.isFinite(amount) && amount >= 0 ? { estimated_cost: amount } : {}),
        cost_status: 'tentative' as const,
      }
    })
    try {
      const { results } = await bookMany.mutateAsync(items)
      const ok = results.filter((r) => r.id).length
      const nextPicks: Record<string, SeatPick[]> = {}
      const nextFailed: Record<string, string> = {}
      for (const r of results) {
        if (r.id) continue
        const row = rows[r.index]!
        nextPicks[row.role] = [...(nextPicks[row.role] ?? []), { id: row.id, payout: row.payout, ...pickOverride(row) }]
        nextFailed[`${row.role}|${row.id}`] = failureText(r.error)
      }
      setPicks(nextPicks)
      setFailed(nextFailed)
      const booked = [...new Set(results.filter((r) => r.id).map((r) => rows[r.index]!.id))]
      setJustBooked(booked.map((id) => byId.get(id)).filter((m): m is TeamMember => !!m))
      if (ok > 0) {
        toast.success(`${ok} ${ok === 1 ? 'person' : 'people'} booked.`)
        setBookedOnce(true)
      }
      if (Object.keys(nextFailed).length === 0) draft.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not book the team.')
    }
  }

  const canBook = !!slotWindow || Object.values(picks).flat().every((p) => windowFor(p, base))

  return (
    <div className="flex flex-col gap-3">
      {/* Only when the shoot has no hours yet: people are booked by the
          clock, so the time is asked for once and saved onto the shoot. The
          shoot's hours are in the line under the title otherwise. */}
      {missingTime && (
        <div className="rounded-lg border border-warning/60 bg-warning/10 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <Clock className="size-4 shrink-0 text-warning" aria-hidden />
            <span className="font-medium">No time set for this shoot yet.</span>
            {!showTime && (
              <Button size="sm" className="ipc-nudge ml-auto" onClick={() => setShowTime(true)}>
                Set the time
              </Button>
            )}
          </div>
          {showTime && (
            <div id="assign-when" className="mt-3 flex flex-col gap-2">
              <ShootWhenFields value={when} onChange={setWhen} idPrefix="assign" compact />
              <div className="flex justify-end">
                <Button size="sm" disabled={!slotWindow || updateShoot.isPending} onClick={saveToShoot}>
                  {updateShoot.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save to shoot
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Progress {...progressWithPicks(withPicks(fill, picks))} />

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {ordered.map((r) => (
          <RoleRow
            key={r.name}
            role={r}
            booked={onShoot.filter((s) => (s.service_name ?? '').toLowerCase() === r.name.toLowerCase())}
            picked={picks[r.name] ?? []}
            base={base}
            slots={slots}
            left={left.get(r.name) ?? 0}
            failed={failed}
            byId={byId}
            open={picker?.role === r.name}
            onOpen={() => setPicker(picker?.role === r.name && !picker.replacing ? null : { role: r.name })}
            onUnpick={(id) => unpick(r.name, id)}
            onPayout={(id, v) => patchPick(r.name, id, { payout: v })}
            onOverride={(id, o) => patchPick(r.name, id, o)}
            onChange={(slot) => setPicker({ role: r.name, replacing: slot })}
            onChangeHours={(slot, w) => void changeHours(slot, w)}
            onEditPayout={setEditing}
            onRemove={(slot) => void remove(slot)}
            picker={
              picker?.role === r.name && (
                <PersonPicker
                  candidates={candidatesFor({
                    members,
                    requirement: r.name,
                    window: picker.replacing
                      ? { start: picker.replacing.start_at, end: picker.replacing.end_at }
                      : slotWindow,
                    shootId: shoot.id,
                    slots,
                    ignoreSlotId: picker.replacing?.id,
                    leaves,
                  })}
                  day={picker.replacing ? localDay(picker.replacing.start_at) : day}
                  slots={slots}
                  ignoreSlotId={picker.replacing?.id}
                  // One person holds one role per sitting, so they are not offered twice.
                  hidden={picker.replacing ? new Set() : taken}
                  title={picker.replacing ? `Who takes ${picker.replacing.user_name ?? 'this'} seat?` : null}
                  busy={update.isPending}
                  onPick={(m) => (picker.replacing ? void replace(picker.replacing, m) : pick(r.name, m))}
                  onNew={session?.is_owner ? () => setQuickAdd(r.name) : undefined}
                  onCancel={() => setPicker(null)}
                />
              )
            }
          />
        ))}
      </ul>

      {justBooked.length > 0 && <AssignedNote members={justBooked} onClose={() => setJustBooked([])} />}

      {total === 0 && <CopyTeamBar shoot={shoot} slots={slots} members={members} leaves={leaves} />}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {/* After a booking with nothing left to book, Done is the one next
            step: solid, with the same nudge the project wizard's Next has. */}
        <Button
          variant={finished ? 'default' : 'outline'}
          className={finished ? 'ipc-nudge' : undefined}
          onClick={onClose}
        >
          {finished && <Check />} Done
        </Button>
        <Button
          variant={finished ? 'outline' : 'default'}
          disabled={!canBook || total === 0 || bookMany.isPending}
          onClick={() => void book()}
        >
          {bookMany.isPending ? <Loader2 className="animate-spin" /> : <Check />}
          {total === 0 ? 'Book' : `Book ${total} ${total === 1 ? 'person' : 'people'}`}
        </Button>
      </div>

      {editing && <EditPayoutDialog slot={editing} onClose={() => setEditing(null)} />}
      {quickAdd && (
        <QuickAddMemberDialog
          requirement={quickAdd}
          onClose={() => setQuickAdd(null)}
          onCreated={(id) => {
            const role = quickAdd
            setQuickAdd(null)
            const m = byId.get(id)
            if (m && (left.get(role) ?? 0) > 0) pick(role, m)
          }}
        />
      )}
    </div>
  )
}

/**
 * Booked seats in green and people picked (not booked yet) in the primary
 * colour, so the bar moves the moment someone is picked.
 */
function Progress({ required, booked, picked, filled }: { required: number; booked: number; picked: number; filled: number }) {
  if (required === 0) return null
  const pct = (n: number) => `${Math.round((n / required) * 100)}%`
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round((filled / required) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Team assigned"
      >
        <div className="h-full bg-success transition-[width] duration-500" style={{ width: pct(booked) }} />
        <div className="h-full bg-primary transition-[width] duration-500" style={{ width: pct(picked) }} />
      </div>
      <p className="shrink-0 text-sm font-medium tabular-nums">
        {picked > 0 ? (
          <>
            <span className="text-primary">{filled} of {required} chosen</span>
            <span className="font-normal text-muted-foreground"> · press Book</span>
          </>
        ) : (
          <span className={filled === required ? 'text-success' : undefined}>
            {filled} of {required} filled
          </span>
        )}
      </p>
    </div>
  )
}

/**
 * A person's hours on one booking, changed without leaving the row: start
 * and duration, Apply, or back to the shoot's own hours.
 */
function HoursEditor({
  initial,
  base,
  onApply,
  onReset,
  onClose,
}: {
  initial: { start?: string | undefined; hours?: number | undefined }
  base: BaseWindow
  onApply: (v: { start: string; hours: number }) => void
  onReset?: (() => void) | undefined
  onClose: () => void
}) {
  const [time, setTime] = useState(initial.start ?? base.time)
  const [hours, setHours] = useState<number | null>(initial.hours ?? base.hours)
  const preview = hours != null ? windowOf(base.date, time, hours) : null
  return (
    <div className="ml-9 mt-1 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-2">
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Start</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Start time for this person" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Duration (अवधि)</Label>
          <DurationField value={hours} onChange={setHours} compact />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{preview ? rangeLabel(preview) : 'Pick the hours'}</span>
        <div className="flex gap-1.5">
          {onReset && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onReset}>
              Shoot’s hours
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs" disabled={!preview || hours == null} onClick={() => hours != null && onApply({ start: time, hours })}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}

/** "4–9 PM · 5 h" beside a name; primary when these are the person's own hours, not the shoot's. */
function HoursChip({ window, own, onEdit, name }: { window: TimeWindow | null; own: boolean; onEdit?: (() => void) | undefined; name: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
          window ? (own ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground') : 'bg-warning/15 text-warning',
        )}
      >
        <Clock className="size-3" aria-hidden />
        {window ? rangeLabel(window) : 'hours not set'}
      </span>
      {onEdit && (
        <button
          type="button"
          aria-label={`Change hours for ${name}`}
          onClick={onEdit}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </span>
  )
}

function RoleRow({
  role,
  booked,
  picked,
  base,
  slots,
  left,
  failed,
  byId,
  open,
  onOpen,
  onUnpick,
  onPayout,
  onOverride,
  onChange,
  onChangeHours,
  onEditPayout,
  onRemove,
  picker,
}: {
  role: RequirementFill
  booked: TeamSlot[]
  picked: SeatPick[]
  base: BaseWindow
  slots: TeamSlot[]
  left: number
  failed: Record<string, string>
  byId: Map<string, TeamMember>
  open: boolean
  onOpen: () => void
  onUnpick: (id: string) => void
  onPayout: (id: string, v: string) => void
  onOverride: (id: string, o: { start?: string | undefined; hours?: number | undefined }) => void
  onChange: (slot: TeamSlot) => void
  onChangeHours: (slot: TeamSlot, w: TimeWindow) => void
  onEditPayout: (slot: TeamSlot) => void
  onRemove: (slot: TeamSlot) => void
  picker: ReactNode
}) {
  const inr = useINR()
  const full = role.open === 0
  const counted = Math.min(role.required, Math.min(role.assigned, role.required) + picked.length)
  const pending = !full && picked.length > 0
  const [menuFor, setMenuFor] = useState<string | null>(null)
  /** Whose hours are being edited: a booking's id or a pick's user id. */
  const [hoursFor, setHoursFor] = useState<string | null>(null)
  return (
    <li className="p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 font-medium">
          <RoleTile name={role.name} size="sm" />
          <span className="truncate">{role.name}</span>
        </p>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
            full ? 'bg-success/10 text-success' : pending ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
          title={pending ? 'Picked, not booked yet: press Book' : undefined}
        >
          {full && <Check className="size-3.5" aria-hidden />}
          {counted} of {role.required}
        </span>
      </div>

      {(booked.length > 0 || picked.length > 0) && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {booked.map((s) => {
            const payout = s.final_cost ?? s.estimated_cost
            const menu = menuFor === s.id
            const w = { start: s.start_at, end: s.end_at }
            return (
              <li key={s.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Avatar name={s.user_name ?? '?'} size="sm" />
                  <span className="min-w-0 flex-1 truncate">
                    {s.user_name ?? 'Someone'}
                    <span className="text-muted-foreground"> · {payout != null ? inr(payout) : 'no payout yet'}</span>
                  </span>
                  <HoursChip window={w} own={false} name={s.user_name ?? 'this person'} />
                  <button
                    type="button"
                    aria-label={`Options for ${s.user_name ?? 'this person'}`}
                    aria-expanded={menu}
                    onClick={() => setMenuFor(menu ? null : s.id)}
                    className={cn('rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground', menu && 'bg-muted text-foreground')}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </div>
                <div className="pl-9">
                  <AlsoBookedLine userId={s.user_id} name={s.user_name ?? 'Someone'} day={localDay(s.start_at)} slots={slots} ignoreSlotId={s.id} />
                </div>
                {/* Inline, not a floating menu: a popover portalled out of the
                    dialog cannot be clicked while the dialog is open. */}
                {menu && (
                  <div className="ml-9 flex flex-wrap gap-1">
                    {(
                      [
                        ['Change person', UserRound, () => onChange(s)],
                        ['Change hours', Clock, () => setHoursFor(s.id)],
                        ['Edit payout', Pencil, () => onEditPayout(s)],
                        ['Remove', Trash2, () => onRemove(s)],
                      ] as const
                    ).map(([label, Icon, run]) => (
                      <Button
                        key={label}
                        size="sm"
                        variant="outline"
                        className={cn('h-7 px-2.5 text-xs', label === 'Remove' && 'text-destructive')}
                        onClick={() => {
                          setMenuFor(null)
                          run()
                        }}
                      >
                        <Icon className="size-3.5" /> {label}
                      </Button>
                    ))}
                  </div>
                )}
                {hoursFor === s.id && (
                  <HoursEditor
                    initial={{ start: new Date(s.start_at).toTimeString().slice(0, 5), hours: Math.round(((Date.parse(s.end_at) - Date.parse(s.start_at)) / 3_600_000) * 2) / 2 }}
                    base={{ ...base, date: localDay(s.start_at) }}
                    onApply={(v) => {
                      const next = windowOf(localDay(s.start_at), v.start, v.hours)
                      if (next) onChangeHours(s, next)
                      setHoursFor(null)
                    }}
                    onClose={() => setHoursFor(null)}
                  />
                )}
              </li>
            )
          })}
          {picked.map((p) => {
            const m = byId.get(p.id)
            const why = failed[`${role.name}|${p.id}`]
            const w = windowFor(p, base)
            const own = !!(p.start || p.hours)
            return (
              <li key={p.id} className="flex flex-col gap-0.5">
                <div
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2 py-1 text-sm',
                    why ? 'border-destructive/50 bg-destructive/5' : 'border-primary/50 bg-primary/5',
                  )}
                >
                  <Avatar name={m?.name ?? '?'} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{m?.name ?? 'Someone'}</span>
                  {/* An empty payout asks to be filled (amber); a filled one reads settled (green). */}
                  <label
                    className={cn(
                      'flex h-8 items-center gap-1 rounded-md border px-2 text-sm shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring',
                      p.payout ? 'border-success/50 bg-success/10' : 'border-warning/60 bg-warning/10',
                    )}
                  >
                    <span className={cn('font-medium', p.payout ? 'text-success' : 'text-warning')}>₹</span>
                    <input
                      aria-label={`Payout for ${m?.name ?? 'this person'}`}
                      inputMode="decimal"
                      placeholder="Add payout"
                      value={p.payout}
                      onChange={(e) => onPayout(p.id, e.target.value.replace(/[^\d.]/g, ''))}
                      className="w-20 bg-transparent text-right text-sm font-medium tabular-nums outline-none placeholder:font-normal placeholder:text-foreground/60"
                    />
                  </label>
                  <HoursChip window={w} own={own} name={m?.name ?? 'this person'} onEdit={() => setHoursFor(hoursFor === p.id ? null : p.id)} />
                  <button
                    type="button"
                    aria-label={`Take ${m?.name ?? 'them'} off`}
                    onClick={() => onUnpick(p.id)}
                    className="rounded-md border border-border bg-card p-1.5 text-muted-foreground shadow-sm hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                {p.why && p.payout && (
                  <p className="pl-9 text-xs text-muted-foreground">
                    Pay {inr(Number(p.payout))} ({p.why})
                  </p>
                )}
                {w && (
                  <div className="pl-9">
                    <AlsoBookedLine userId={p.id} name={m?.name ?? 'Someone'} day={localDay(w.start)} slots={slots} />
                  </div>
                )}
                {why && <p className="pl-2 text-xs text-destructive">{why}. Take them off or pick someone else.</p>}
                {hoursFor === p.id && (
                  <HoursEditor
                    initial={pickOverride(p)}
                    base={base}
                    onApply={(v) => {
                      onOverride(p.id, v)
                      setHoursFor(null)
                    }}
                    onReset={
                      own
                        ? () => {
                            onOverride(p.id, { start: undefined, hours: undefined })
                            setHoursFor(null)
                          }
                        : undefined
                    }
                    onClose={() => setHoursFor(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {left > 0 && !open && (
        <button
          type="button"
          onClick={onOpen}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-primary hover:border-primary hover:bg-primary/5"
        >
          <Plus className="size-4" /> {left === 1 ? 'Choose person' : `Choose ${left} people`}
        </button>
      )}
      {open && picker}
    </li>
  )
}

/**
 * Who can take this seat: free people, role fits first, each with one line
 * about their day -- free all day, or free with what else they have on and
 * when; on leave; the busy ones in one folded line.
 */
function PersonPicker({
  candidates,
  day,
  slots,
  ignoreSlotId,
  hidden,
  title,
  busy,
  onPick,
  onNew,
  onCancel,
}: {
  candidates: Candidate[]
  day: string
  slots: TeamSlot[]
  ignoreSlotId?: string | undefined
  hidden: Set<string>
  title: string | null
  busy: boolean
  onPick: (m: TeamMember) => void
  onNew: (() => void) | undefined
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  const [showBusy, setShowBusy] = useState(false)
  const query = q.trim().toLowerCase()
  const matches = (c: Candidate) =>
    !query ||
    c.member.name.toLowerCase().includes(query) ||
    c.member.role_names.some((r) => r.toLowerCase().includes(query)) ||
    (c.member.phone ?? '').includes(query)
  const free = candidates.filter((c) => canPick(c.availability) && !hidden.has(c.member.user_id) && matches(c))
  const unavailable = candidates.filter((c) => !canPick(c.availability) && matches(c))
  const othersOf = (c: Candidate) => bookingsOn(c.member.user_id, day, slots, { ignoreSlotId })
  const lineFor = (c: Candidate) => availabilityLine(c, othersOf(c))
  const dayCard = (c: Candidate) => ({ name: c.member.name, userId: c.member.user_id, day, slots, leave: c.leave })

  return (
    <div className="mt-2 rounded-lg border border-border bg-card">
      {title && <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">{title}</p>}
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or role"
            className="h-8 pl-8"
            aria-label="Search people"
          />
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Close
        </Button>
      </div>

      {free.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          {query ? 'Nobody free by that name.' : 'Nobody is free at this time.'}
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label="Free people">
          {free.map((c) => {
            const line = lineFor(c)
            return (
              <li key={c.member.user_id} className="rounded-md hover:bg-muted">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={busy}
                  onClick={() => onPick(c.member)}
                  className="flex w-full items-center gap-2 rounded-md px-2 pt-1.5 text-left text-sm disabled:opacity-50"
                >
                  <Avatar name={c.member.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.member.name}</span>
                    {c.member.role_names.length > 0 && (
                      <span className="block truncate text-xs text-muted-foreground">{c.member.role_names.join(', ')}</span>
                    )}
                  </span>
                  {c.match && (
                    <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">Fits</span>
                  )}
                </button>
                {/* Beside the pick button, not inside it: tapping the line opens
                    their day; tapping the name picks them. */}
                <div className="pb-1.5 pl-10 pr-2">
                  <PersonDayLine line={line} {...dayCard(c)} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5">
        {unavailable.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowBusy((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {unavailable.length} busy at this time {showBusy ? '▴' : '▾'}
          </button>
        ) : (
          <span />
        )}
        {onNew && (
          <button type="button" onClick={onNew} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Plus className="size-3" /> New team member
          </button>
        )}
      </div>
      {showBusy && unavailable.length > 0 && (
        <ul className="max-h-48 overflow-y-auto border-t border-border px-1 pb-1 pt-1">
          {unavailable.map((c) => {
            const line = lineFor(c)
            return (
              <li key={c.member.user_id} className="flex items-start gap-2 px-2 py-1 text-sm text-muted-foreground">
                <Avatar name={c.member.name} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="block truncate">{c.member.name}</span>
                  <PersonDayLine line={line} {...dayCard(c)} />
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const COST_STATUS: { value: SlotCostStatus; label: string }[] = [
  { value: 'tentative', label: 'Tentative' },
  { value: 'final', label: 'Final' },
  { value: 'not_decided', label: 'Not decided' },
]

/** The payout for one booking: amount, whether it is agreed, a note. Team members never see it. */
function EditPayoutDialog({ slot, onClose }: { slot: TeamSlot; onClose: () => void }) {
  const setCost = useSetSlotCost()
  const [amount, setAmount] = useState(() => {
    const v = slot.final_cost ?? slot.estimated_cost
    return v != null ? String(v) : ''
  })
  const [status, setStatus] = useState<SlotCostStatus>(slot.cost_status)
  const [note, setNote] = useState(slot.cost_notes ?? '')

  function save() {
    const n = amount.trim() === '' ? null : Number(amount)
    if (n != null && (!Number.isFinite(n) || n < 0)) {
      toast.error('Payout must be a positive number.')
      return
    }
    setCost.mutate(
      {
        id: slot.id,
        patch: {
          estimated_cost: status === 'not_decided' ? null : n,
          ...(status === 'final' ? { final_cost: n } : {}),
          cost_status: status,
          cost_notes: note.trim() || null,
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-sm"
        title={`Payout · ${slot.user_name ?? 'this booking'}`}
        description="Only you see this. Team members never do."
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-amount" className="text-xs">
                Amount (₹)
              </Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={amount}
                disabled={status === 'not_decided'}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-status" className="text-xs">
                Status
              </Label>
              <Select id="pay-status" value={status} onChange={(e) => setStatus(e.target.value as SlotCostStatus)}>
                {COST_STATUS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pay-note" className="text-xs">
              Note
            </Label>
            <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={setCost.isPending} onClick={save}>
              {setCost.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
