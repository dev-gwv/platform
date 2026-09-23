import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, ChevronLeft, ChevronRight, Download, IndianRupee, Pencil, UserPlus, Users, X } from 'lucide-react'
import { findConflicts, overlaps } from '@ipc/domain'
import { shootListItem, type BookSlotRequest, type ShootListItem, type TeamSlot } from '@ipc/contracts'
import { toast } from 'sonner'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { BulkAssignDialog } from '@/features/shoots/BulkAssignDialog'
import { PageHeader } from '@/shared/layout/page-header'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { downloadCsv } from '@/shared/ui/csv'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { formatINR } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { useSlots, useMembers, useBookSlot, useSetSlotStatus, useSetSlotCost, useUpdateSlot, ApiError } from '@/features/allocation/api'
import { crewState, rolesFilled, rolesNeeded } from '@ipc/domain'

export function TeamAllocationPage({ initialTab }: { initialTab?: Tab } = {}) {
  return (
    <AuthedPage module="projects">
      <TeamBooking initialTab={initialTab} />
    </AuthedPage>
  )
}

type Tab = 'calendar' | 'dashboard' | 'conflicts'
type CalendarView = 'month' | 'member'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const dayHeading = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})
const shortDay = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
const same = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/**
 * Team Booking — a month of shoots, and who is on each one.
 *
 * Built around the shoot rather than the booking. A flat list of slots cannot
 * answer the question a manager actually has — "Saturday needs two
 * photographers, has it got them?" — so the requirements recorded on the shoot
 * are the frame, and bookings are filled against them.
 */
function TeamBooking({ initialTab }: { initialTab?: Tab | undefined }) {
  const { session } = useAuth()
  const access = useAccess()
  const [tab, setTab] = useState<Tab>(initialTab ?? 'calendar')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [view, setView] = useState<CalendarView>('month')
  const today = new Date()
  /**
   * `?month=YYYY-MM` opens on that month. A project's Allocation action used to
   * link here bare, so a wedding whose shoots are in February landed on the
   * current month reading "Nothing booked this month" — which is true, and
   * useless.
   */
  const asked = (() => {
    if (typeof window === 'undefined') return null
    const v = new URLSearchParams(window.location.search).get('month')
    const m = v && /^\d{4}-\d{2}$/.test(v) ? v : null
    if (!m) return null
    const [y, mo] = m.split('-').map(Number)
    return y && mo && mo >= 1 && mo <= 12 ? { year: y, month: mo - 1 } : null
  })()
  const [year, setYear] = useState(asked?.year ?? today.getFullYear())
  const [month, setMonth] = useState(asked?.month ?? today.getMonth())
  /** The shoot an "Assign" press came from, so the dialog opens already filled. */
  const [assignTo, setAssignTo] = useState<ShootListItem | null>(null)

  const slots = useSlots()
  const shoots = useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: shootListItem.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })

  const booked = useMemo(() => (slots.data ?? []).filter((s) => s.status === 'booked'), [slots.data])

  const from = new Date(year, month, 1)
  const to = new Date(year, month + 1, 0)
  /** Every slot of any status that starts within the selected month — what the Dashboard tab counts against. */
  const slotsInMonth = useMemo(() => {
    const start = from.getTime()
    const end = to.getTime() + 24 * 60 * 60 * 1000 - 1
    return (slots.data ?? []).filter((s) => {
      const t = new Date(s.start_at).getTime()
      return t >= start && t <= end
    })
  }, [slots.data, year, month])
  const inMonth = useMemo(() => {
    const mm = String(month + 1).padStart(2, '0')
    const start = `${year}-${mm}-01`
    const end = `${year}-${mm}-${String(to.getDate()).padStart(2, '0')}`
    return (shoots.data ?? [])
      .filter((s) => s.shoot_date && s.shoot_date >= start && s.shoot_date <= end)
      .filter((s) => s.status !== 'cancelled')
      .sort((a, b) => (a.shoot_date ?? '').localeCompare(b.shoot_date ?? ''))
  }, [shoots.data, year, month, to])

  /** Shoots under their day, which is how a month gets read. */
  const days = useMemo(() => {
    const map = new Map<string, ShootListItem[]>()
    for (const s of inMonth) {
      if (!s.shoot_date) continue
      map.set(s.shoot_date, [...(map.get(s.shoot_date) ?? []), s])
    }
    return [...map.entries()]
  }, [inMonth])

  const step = (by: number) => {
    const next = new Date(year, month + by, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth())
  }

  function exportCsv() {
    const rows = slots.data ?? []
    if (rows.length === 0) {
      toast.error('Nothing to export.')
      return
    }
    const lines = rows.map((s) =>
      [
        s.user_name ?? '', s.service_name ?? '', s.start_at, s.end_at, s.status,
        s.estimated_cost ?? '', s.final_cost ?? '', s.cost_status,
      ]
        .map((v) => {
          const str = String(v ?? '')
          return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
        })
        .join(','),
    )
    downloadCsv(
      `team-slots-${year}-${String(month + 1).padStart(2, '0')}.csv`,
      ['Member,Role,Start,End,Status,Estimated,Final,Cost status', ...lines].join('\n'),
    )
  }

  return (
    <>
      <PageHeader
        title="Team Booking"
        description="Book your team for upcoming shoots and avoid double-booking."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={(slots.data ?? []).length === 0}>
              <Download /> Export CSV
            </Button>
            <BookDialog
              shoots={inMonth}
              trigger={
                <Button variant="outline">
                  <UserPlus /> Book someone
                </Button>
              }
            />
            {/* The old button said Bulk Assign but opened a one-booking form. */}
            <Button onClick={() => setBulkOpen(true)}>
              <Users /> Bulk Assign
            </Button>
            {bulkOpen && <BulkAssignDialog onClose={() => setBulkOpen(false)} />}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1.5">
        {(['calendar', 'dashboard', 'conflicts'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors',
              tab === t
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'calendar' && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-border p-1">
              {(['month', 'member'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm font-medium capitalize transition-colors',
                    view === v
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v} view
                </button>
              ))}
            </div>

            <Stepper
              label={String(year)}
              onPrev={() => setYear((y) => y - 1)}
              onNext={() => setYear((y) => y + 1)}
            />
            <Stepper label={MONTHS[month] ?? ''} onPrev={() => step(-1)} onNext={() => step(1)} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setYear(today.getFullYear())
                setMonth(today.getMonth())
              }}
            >
              Today
            </Button>

            <span className="ml-auto text-sm text-muted-foreground">
              {shortDay.format(from)} – {shortDay.format(to)}, {year}
            </span>
          </div>

          <div className="mt-4">
            {shoots.isLoading || slots.isLoading ? (
              <SkeletonCards count={3} />
            ) : shoots.isError ? (
              <ErrorState error={shoots.error} onRetry={() => void shoots.refetch()} />
            ) : view === 'member' ? (
              <MemberView slots={booked} from={from} to={to} />
            ) : days.length === 0 ? (
              <EmptyState
                title="Nothing booked this month"
                description="Shoots scheduled in this month show up here, each with the crew it still needs."
              />
            ) : (
              <div className="flex flex-col gap-4">
                {days.map(([date, dayShoots]) => (
                  <div key={date}>
                    <div className="mb-2 flex items-center gap-2">
                      <p className="font-semibold">
                        {dayHeading.format(new Date(`${date}T00:00:00`))}
                      </p>
                      <StatusBadge>
                        {dayShoots.length} shoot{dayShoots.length === 1 ? '' : 's'}
                      </StatusBadge>
                    </div>
                    <div className="flex flex-col gap-3">
                      {dayShoots.map((s) => (
                        <ShootRow
                          key={s.id}
                          shoot={s}
                          slots={booked}
                          onAssign={() => setAssignTo(s)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'dashboard' && (
        <BookingDashboard
          slots={slotsInMonth}
          shoots={inMonth}
          onOpenCalendar={() => setTab('calendar')}
        />
      )}
      {tab === 'conflicts' && <Conflicts slots={slots.data ?? []} shoots={shoots.data ?? []} />}

      {/* Every per-shoot Assign press opens this one, keyed so it starts fresh. */}
      {assignTo && (
        <BookDialog
          key={assignTo.id}
          shoots={inMonth}
          prefill={assignTo}
          openNow
          onClosed={() => setAssignTo(null)}
        />
      )}
    </>
  )
}

function Stepper({
  label,
  onPrev,
  onNext,
}: {
  label: string
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-border p-1">
      <button
        type="button"
        onClick={onPrev}
        aria-label={`Previous, from ${label}`}
        className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-24 text-center text-sm font-medium">{label}</span>
      <button
        type="button"
        onClick={onNext}
        aria-label={`Next, from ${label}`}
        className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}

/**
 * One shoot on its day: what it needs, and who is in against it.
 *
 * Bookings match a requirement by service name — the same name the shoot card
 * wrote — so "Candid Photographer 1/2" reads as one short of the plan.
 */
const COST_STATUS_TONE = { not_decided: 'neutral', tentative: 'warning', final: 'success' } as const

/** Cost is settled separately from the booking -- what a shoot day is worth to pay out. */
function EditSlotCostDialog({ slot }: { slot: TeamSlot }) {
  const setCost = useSetSlotCost()
  const [open, setOpen] = useState(false)
  const [estimated, setEstimated] = useState(String(slot.estimated_cost ?? ''))
  const [final, setFinal] = useState(String(slot.final_cost ?? ''))
  const [status, setStatus] = useState(slot.cost_status)
  const [notes, setNotes] = useState(slot.cost_notes ?? '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setEstimated(String(slot.estimated_cost ?? ''))
    setFinal(String(slot.final_cost ?? ''))
    setStatus(slot.cost_status)
    setNotes(slot.cost_notes ?? '')
    setError(null)
  }, [open, slot])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await setCost.mutateAsync({
        id: slot.id,
        patch: {
          estimated_cost: estimated.trim() ? Number(estimated) : undefined,
          final_cost: final.trim() ? Number(final) : undefined,
          cost_status: status,
          cost_notes: notes.trim() || undefined,
        },
      })
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save the cost.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-4" title="Edit cost">
          <IndianRupee className="size-3" />
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Cost — ${slot.user_name ?? 'this booking'}`}
        description={slot.service_name ?? undefined}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Estimated (₹)</Label>
              <Input type="number" min={0} value={estimated} onChange={(e) => setEstimated(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Final (₹)</Label>
              <Input type="number" min={0} value={final} onChange={(e) => setFinal(e.target.value)} placeholder="Once agreed" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as TeamSlot['cost_status'])}>
              <option value="not_decided">Not decided</option>
              <option value="tentative">Tentative</option>
              <option value="final">Final</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How this figure was agreed" />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={setCost.isPending}>
              {setCost.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Edit a booking's who/when/what (Lovable parity: edit slot). Cost and status have their own dialogs/actions. */
function EditSlotDialog({ slot, onClose }: { slot: TeamSlot; onClose: () => void }) {
  const members = useMembers()
  const update = useUpdateSlot()
  const [userId, setUserId] = useState(slot.user_id)
  const [service, setService] = useState(slot.service_name ?? '')
  const [start, setStart] = useState(toLocalInput(slot.start_at))
  const [end, setEnd] = useState(toLocalInput(slot.end_at))
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const startIso = new Date(start).toISOString()
      const endIso = new Date(end).toISOString()
      if (!(new Date(endIso) > new Date(startIso))) {
        setError('End must be after start.')
        return
      }
      await update.mutateAsync({
        id: slot.id,
        patch: {
          user_id: userId,
          service_name: service.trim() || null,
          start_at: startIso,
          end_at: endIso,
        },
      })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save these changes.')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title="Edit booking" description={slot.user_name ?? undefined}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Member</Label>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} required>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Input value={service} onChange={(e) => setService(e.target.value)} placeholder="Candid Photographer" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Start</Label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End</Label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
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

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ShootRow({
  shoot,
  slots,
  onAssign,
}: {
  shoot: ShootListItem
  slots: readonly TeamSlot[]
  onAssign: () => void
}) {
  const setStatus = useSetSlotStatus()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<TeamSlot | null>(null)
  const mine = slots.filter((s) => s.shoot_id === shoot.id)
  const filledFor = (name: string) => mine.filter((s) => same(s.service_name, name)).length

  async function onCancel(s: TeamSlot) {
    const yes = await confirm({
      title: `Cancel ${s.user_name ?? 'this'}'s booking?`,
      description: s.service_name ? `${s.service_name} on ${shoot.name}.` : `On ${shoot.name}.`,
      confirmLabel: 'Cancel booking',
      destructive: true,
    })
    if (yes) setStatus.mutate({ id: s.id, status: 'cancelled' })
  }

  async function onRelease(s: TeamSlot) {
    const yes = await confirm({
      title: `Release ${s.user_name ?? 'this'} from this slot?`,
      description: 'Released slots no longer block future bookings.',
      confirmLabel: 'Release',
    })
    if (yes) setStatus.mutate({ id: s.id, status: 'released' })
  }
  const needed = shoot.requirements.reduce((n, r) => n + r.quantity, 0)
  const filled = shoot.requirements.reduce((n, r) => n + Math.min(r.quantity, filledFor(r.name)), 0)
  const date = shoot.shoot_date ? new Date(`${shoot.shoot_date}T00:00:00`) : null

  return (
    <Card className="lift">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          {date && (
            <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-lg border border-border">
              <span className="text-[0.65rem] font-semibold uppercase text-muted-foreground">
                {date.toLocaleString('en-IN', { month: 'short' })}
              </span>
              <span className="text-xl font-semibold leading-none">{date.getDate()}</span>
              <span className="text-[0.65rem] uppercase text-muted-foreground">
                {date.toLocaleString('en-IN', { weekday: 'short' })}
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="font-semibold">{shoot.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {shoot.project_name ?? '—'}
              {shoot.client_name ? ` · ${shoot.client_name}` : ''}
            </p>
            {shoot.location && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{shoot.location}</p>
            )}
          </div>

          {shoot.requirements.length === 0 ? (
            <StatusBadge>No roles</StatusBadge>
          ) : (
            <StatusBadge tone={filled >= needed ? 'success' : 'warning'}>
              {filled} of {needed} booked
            </StatusBadge>
          )}
        </div>

        <div className="mt-3 rounded-lg border border-border p-3">
          {shoot.requirements.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                No requirements yet. Add roles in the shoot first.
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/projects/$id" params={{ id: shoot.project_id }}>
                  Open shoot
                </Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {shoot.requirements.map((r) => {
                const have = filledFor(r.name)
                const who = mine.filter((s) => same(s.service_name, r.name))
                return (
                  <span
                    key={r.service_id}
                    title={who.map((s) => s.user_name ?? 'Member').join(', ') || undefined}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                      have >= r.quantity
                        ? 'border-success/40 bg-success/10 text-success'
                        : 'border-warning/40 bg-warning/10 text-warning',
                    )}
                  >
                    {r.name}
                    <span className="font-semibold tabular-nums">
                      {have}/{r.quantity}
                    </span>
                  </span>
                )
              })}
              <Button variant="outline" size="sm" className="ml-auto" onClick={onAssign}>
                <UserPlus /> Assign
              </Button>
            </div>
          )}
        </div>

        {mine.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Booked:</span>
            {mine.map((s) => (
              <span
                key={s.id}
                className="flex items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-2 pr-1 text-xs"
              >
                <Link to="/team-allocation/member/$uid" params={{ uid: s.user_id }} className="hover:underline">
                  {s.user_name ?? 'Member'}
                </Link>
                {s.service_name ? ` · ${s.service_name}` : ''}
                <StatusBadge
                  tone={s.status === 'booked' ? 'info' : s.status === 'released' ? 'neutral' : 'danger'}
                  className="px-1.5 py-0 text-[0.65rem]"
                >
                  {s.status}
                </StatusBadge>
                {s.cost_status !== 'not_decided' && (
                  <StatusBadge tone={COST_STATUS_TONE[s.cost_status]} className="px-1.5 py-0 text-[0.65rem]">
                    {formatINR(s.final_cost ?? s.estimated_cost ?? 0)}
                  </StatusBadge>
                )}
                <EditSlotCostDialog slot={s} />
                {s.status === 'booked' && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-4"
                      title="Edit this booking"
                      onClick={() => setEditing(s)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-4"
                      title="Release this booking (frees the slot)"
                      onClick={() => void onRelease(s)}
                      disabled={setStatus.isPending}
                    >
                      <CalendarClock className="size-3" />
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-4"
                  title="Cancel this booking"
                  onClick={() => void onCancel(s)}
                  disabled={setStatus.isPending}
                >
                  <X className="size-3" />
                </Button>
              </span>
            ))}
          </div>
        )}
        {editing && <EditSlotDialog slot={editing} onClose={() => setEditing(null)} />}
      </CardContent>
    </Card>
  )
}

/** Who is booked, and how heavily, across the month on screen. */
function MemberView({ slots, from, to }: { slots: readonly TeamSlot[]; from: Date; to: Date }) {
  const end = new Date(to)
  end.setHours(23, 59, 59, 999)
  const byMember = new Map<string, TeamSlot[]>()
  for (const s of slots) {
    const at = new Date(s.start_at)
    if (at < from || at > end) continue
    const key = s.user_name ?? 'Unnamed'
    byMember.set(key, [...(byMember.get(key) ?? []), s])
  }

  if (byMember.size === 0) {
    return (
      <EmptyState
        title="Nobody booked this month"
        description="Assign crew to a shoot and their days show up here."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {[...byMember.entries()].map(([name, theirs]) => (
        <Card key={name}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{name}</p>
              <StatusBadge tone={theirs.length > 8 ? 'warning' : 'neutral'}>
                {theirs.length} day{theirs.length === 1 ? '' : 's'}
              </StatusBadge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {theirs.map((s) => (
                <span
                  key={s.id}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                >
                  {shortDay.format(new Date(s.start_at))} · {s.service_name ?? 'Crew'}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** How the month is going: roles planned, roles filled, what it costs. */
function BookingDashboard({
  slots,
  shoots,
  onOpenCalendar,
}: {
  /** Every slot of any status starting this month — not pre-filtered to "booked". */
  slots: readonly TeamSlot[]
  shoots: readonly ShootListItem[]
  onOpenCalendar: () => void
}) {
  const members = useMembers()
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [search, setSearch] = useState('')

  const slotRows = slots
  const booked = slots.filter((s) => s.status === 'booked')
  const released = slots.filter((s) => s.status === 'released')
  const cancelled = slots.filter((s) => s.status === 'cancelled')

  // From @ipc/domain, so this screen and the shoots list cannot disagree about
  // which days still need people — this tile links straight to that list.
  const needed = shoots.reduce((n, s) => n + rolesNeeded(s.requirements), 0)
  const filled = shoots.reduce((n, s) => n + rolesFilled(s.id, s.requirements, slotRows), 0)
  const pending = Math.max(0, needed - filled)
  const unstaffed = shoots.filter((s) => crewState(s.id, s.requirements, slotRows) === 'unplanned').length
  const unassignedShoots = shoots.filter((s) => {
    const state = crewState(s.id, s.requirements, slotRows)
    return state === 'unassigned' || state === 'partial'
  }).length
  // Only booked slots can clash for real — a released or cancelled slot freed up
  // its time, so counting it here would flag a false double-booking.
  const conflicts = findClashes(booked).length
  const cost = booked.reduce((n, s) => n + (s.estimated_cost ?? 0), 0)
  const activeMemberIds = new Set(booked.map((s) => s.user_id))
  const available = Math.max(0, (members.data?.length ?? 0) - activeMemberIds.size)

  const roles = [...new Set(slots.map((s) => s.service_name).filter((v): v is string => !!v))].sort()

  const filteredSlots = slots
    .filter((s) => !status || s.status === status)
    .filter((s) => !role || s.service_name === role)
    .filter((s) => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return (s.user_name ?? '').toLowerCase().includes(q) || (s.service_name ?? '').toLowerCase().includes(q)
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at))

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Shoots this month" value={String(shoots.length)} />
        <Figure label="Roles needed" value={String(needed)} />
        <Figure
          label="Roles filled"
          value={`${filled} of ${needed}`}
          tone={needed === 0 ? undefined : filled >= needed ? 'success' : 'warning'}
        />
        <Figure label="Pending" value={String(pending)} tone={pending > 0 ? 'warning' : undefined} />
        {/*
          * A count of a problem should reach the rows behind it. This one was
          * a dead end: it said three shoots needed crew and the shoots list
          * had no way to show which three.
          */}
        <Figure
          label="Unassigned shoots"
          value={String(unassignedShoots)}
          tone={unassignedShoots > 0 ? 'warning' : undefined}
          {...(unassignedShoots > 0
            ? { to: '/shoots', search: { crew: 'unassigned' }, hint: 'See which' }
            : {})}
        />
        <Figure label="Conflicts" value={String(conflicts)} tone={conflicts > 0 ? 'warning' : undefined} />
        <Figure label="Active members" value={String(activeMemberIds.size)} />
        <Figure label="Booked" value={String(booked.length)} />
        <Figure label="Available" value={String(available)} />
        <Figure label="Released" value={String(released.length)} />
        <Figure label="Cancelled" value={String(cancelled.length)} />
        <Figure label="Booked cost" value={formatINR(cost)} />
      </div>

      {unstaffed > 0 && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {unstaffed} shoot{unstaffed === 1 ? ' has' : 's have'} no roles listed yet, so nothing
            can be booked against {unstaffed === 1 ? 'it' : 'them'}.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="booked">Booked</option>
          <option value="released">Released</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-40" aria-label="Filter by role">
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by person or role…"
          className="w-56"
          aria-label="Search bookings"
        />
        <BookDialog shoots={shoots} trigger={<Button size="sm"><UserPlus /> Book slot</Button>} />
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onOpenCalendar}>
          Open calendar →
        </Button>
      </div>

      {filteredSlots.length === 0 ? (
        <EmptyState
          title="No bookings match"
          description="Try a different filter, or book someone for this month."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filteredSlots.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="font-medium">{s.user_name ?? 'Unknown'}</span>
                <span className="text-muted-foreground">{s.service_name ?? 'Crew'}</span>
                <span className="text-muted-foreground">
                  {shortDay.format(new Date(s.start_at))} · {timeOf(s.start_at)}–{timeOf(s.end_at)}
                </span>
                <StatusBadge
                  tone={s.status === 'booked' ? 'info' : s.status === 'released' ? 'neutral' : 'danger'}
                  className="ml-auto"
                >
                  {s.status}
                </StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Figure({
  label,
  value,
  tone,
  to,
  search,
  hint,
}: {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'danger' | undefined
  /** Set when the number has rows behind it worth reaching. */
  to?: string | undefined
  search?: Record<string, string> | undefined
  hint?: string | undefined
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          {label}
          {to && (
            <Link to={to as never} search={search as never} className="text-xs font-medium text-primary hover:underline">
              {hint ?? 'View'}
            </Link>
          )}
        </p>
        <p
          className={cn(
            'mt-0.5 text-xl font-semibold tabular-nums',
            tone === 'success' && 'text-success',
            tone === 'warning' && 'text-warning',
            tone === 'danger' && 'text-destructive',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

/** Every pair of slots that book the same person over the same time. */
function findClashes(slots: readonly TeamSlot[]): [TeamSlot, TeamSlot][] {
  const clashes: [TeamSlot, TeamSlot][] = []
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!
      const b = slots[j]!
      if (a.user_id === b.user_id && overlaps(a, b)) clashes.push([a, b])
    }
  }
  return clashes
}

type ConflictSeverity = 'critical' | 'warning' | 'info'
type ConflictType = 'double_booking' | 'invalid_time_range' | 'missing_shoot' | 'missing_service' | 'past_active'

interface ConflictItem {
  key: string
  type: ConflictType
  severity: ConflictSeverity
  slot: TeamSlot
  pairSlot?: TeamSlot
  message: string
}

const CONFLICT_TYPE_LABEL: Record<ConflictType, string> = {
  double_booking: 'Double booking',
  invalid_time_range: 'Invalid time range',
  missing_shoot: 'Missing shoot',
  missing_service: 'Missing service',
  past_active: 'Past active',
}

const SEVERITY_TONE: Record<ConflictSeverity, 'danger' | 'warning' | 'info'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
}

/**
 * Every data-quality issue across booked slots, not just double-bookings — a
 * slot can also be missing its shoot/service link, have a corrupt time range,
 * or still say "booked" for a shoot day that has already passed.
 */
function findConflictItems(slots: readonly TeamSlot[]): ConflictItem[] {
  const booked = slots.filter((s) => s.status === 'booked')
  const items: ConflictItem[] = []
  const now = Date.now()

  for (const [a, b] of findClashes(booked)) {
    items.push({
      key: `double-${a.id}-${b.id}`,
      type: 'double_booking',
      severity: 'critical',
      slot: a,
      pairSlot: b,
      message: `${a.user_name ?? 'Someone'} is booked twice`,
    })
  }
  for (const s of booked) {
    if (new Date(s.end_at).getTime() <= new Date(s.start_at).getTime()) {
      items.push({ key: `range-${s.id}`, type: 'invalid_time_range', severity: 'critical', slot: s, message: 'Ends before (or at) its own start' })
    }
    if (!s.shoot_id) {
      items.push({ key: `shoot-${s.id}`, type: 'missing_shoot', severity: 'warning', slot: s, message: 'Not linked to a shoot' })
    }
    if (!s.service_name) {
      items.push({ key: `service-${s.id}`, type: 'missing_service', severity: 'warning', slot: s, message: 'No role or service set' })
    }
    if (new Date(s.end_at).getTime() < now) {
      items.push({ key: `past-${s.id}`, type: 'past_active', severity: 'info', slot: s, message: 'Still booked after its time has passed' })
    }
  }
  return items
}

const toDateInput = (d: Date) => d.toISOString().slice(0, 10)

/**
 * A data-quality report across every booked slot: double-bookings the GiST
 * constraint ought to have refused, plus corrupt or incomplete rows that
 * would otherwise quietly throw off the Dashboard tab's counts.
 */
function Conflicts({ slots, shoots }: { slots: readonly TeamSlot[]; shoots: readonly ShootListItem[] }) {
  const shootById = useMemo(() => new Map(shoots.map((s) => [s.id, s])), [shoots])
  const [severity, setSeverity] = useState<'all' | ConflictSeverity>('all')
  const [type, setType] = useState<'all' | ConflictType>('all')
  const [from, setFrom] = useState(() => toDateInput(new Date()))
  const [to, setTo] = useState(() => toDateInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)))
  const [search, setSearch] = useState('')

  const all = useMemo(() => findConflictItems(slots), [slots])

  /**
   * What is in view: the date range and the search, but NOT severity or type.
   *
   * The tiles counted `all`, so they described conflicts outside the window
   * the list was showing — and the window defaults to the next thirty days,
   * which means they disagreed on first render, before anyone touched a
   * filter. "Critical 3" above a list of one, with the other two unreachable
   * in a month nobody is looking at, is worse than no tile.
   *
   * Severity and type stay out of the scope deliberately: those two are the
   * drill-down, so the tiles are what you read to decide which to click.
   */
  const scoped = useMemo(() => {
    const start = new Date(from).getTime()
    const end = new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1
    return all
      .filter((i) => {
        const t = new Date(i.slot.start_at).getTime()
        return t >= start && t <= end
      })
      .filter((i) => {
        if (!search.trim()) return true
        const q = search.trim().toLowerCase()
        const shoot = i.slot.shoot_id ? shootById.get(i.slot.shoot_id) : undefined
        return (
          (i.slot.user_name ?? '').toLowerCase().includes(q) ||
          (i.slot.service_name ?? '').toLowerCase().includes(q) ||
          (shoot?.name ?? '').toLowerCase().includes(q) ||
          (shoot?.project_name ?? '').toLowerCase().includes(q)
        )
      })
  }, [all, from, to, search, shootById])

  const counts = useMemo(
    () => ({
      total: scoped.length,
      critical: scoped.filter((i) => i.severity === 'critical').length,
      warning: scoped.filter((i) => i.severity === 'warning').length,
      doubleBooking: scoped.filter((i) => i.type === 'double_booking').length,
      pastActive: scoped.filter((i) => i.type === 'past_active').length,
    }),
    [scoped],
  )

  const filtered = useMemo(
    () =>
      scoped
        .filter((i) => severity === 'all' || i.severity === severity)
        .filter((i) => type === 'all' || i.type === type)
        .sort((a, b) => a.slot.start_at.localeCompare(b.slot.start_at)),
    [scoped, severity, type],
  )

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Figure label="Total" value={String(counts.total)} tone={counts.total > 0 ? 'warning' : undefined} />
        <Figure label="Critical" value={String(counts.critical)} tone={counts.critical > 0 ? 'danger' : undefined} />
        <Figure label="Warnings" value={String(counts.warning)} tone={counts.warning > 0 ? 'warning' : undefined} />
        <Figure label="Double bookings" value={String(counts.doubleBooking)} tone={counts.doubleBooking > 0 ? 'danger' : undefined} />
        <Figure label="Past active" value={String(counts.pastActive)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className="w-36" aria-label="Filter by severity">
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-44" aria-label="Filter by type">
          <option value="all">All types</option>
          {(Object.keys(CONFLICT_TYPE_LABEL) as ConflictType[]).map((t) => (
            <option key={t} value={t}>
              {CONFLICT_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To date" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Member, service, shoot, project…"
          className="w-56"
          aria-label="Search conflicts"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No allocation conflicts found for this date range."
          description="Adjust filters or expand the date window to review more slots."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((i) => {
            const shoot = i.slot.shoot_id ? shootById.get(i.slot.shoot_id) : undefined
            return (
              <Card
                key={i.key}
                className={cn(
                  i.severity === 'critical' && 'border-destructive/40',
                  i.severity === 'warning' && 'border-warning/40',
                )}
              >
                <CardContent className="flex flex-wrap items-start gap-3 p-4">
                  <StatusBadge tone={SEVERITY_TONE[i.severity]} className="mt-0.5">
                    {CONFLICT_TYPE_LABEL[i.type]}
                  </StatusBadge>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{i.message}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {i.slot.user_name ?? 'Someone'} · {shortDay.format(new Date(i.slot.start_at))} ·{' '}
                      {timeOf(i.slot.start_at)}–{timeOf(i.slot.end_at)}
                      {i.slot.service_name ? ` · ${i.slot.service_name}` : ''}
                      {shoot ? ` · ${shoot.name}${shoot.project_name ? ` (${shoot.project_name})` : ''}` : ''}
                    </p>
                    {i.pairSlot && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Clashes with {timeOf(i.pairSlot.start_at)}–{timeOf(i.pairSlot.end_at)}
                        {i.pairSlot.service_name ? ` · ${i.pairSlot.service_name}` : ''}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Book one member onto one shoot.
 *
 * The role is typed against the shoot's own requirements, because a booking
 * only counts towards a gap when the two names agree — offering the shoot's
 * list makes that the easy path rather than a thing to remember.
 */
function BookDialog({
  shoots,
  prefill,
  openNow,
  onClosed,
  trigger,
}: {
  shoots: readonly ShootListItem[]
  prefill?: ShootListItem | null
  openNow?: boolean
  onClosed?: () => void
  trigger?: ReactNode
}) {
  const members = useMembers()
  const slots = useSlots()
  const book = useBookSlot()
  const [open, setOpen] = useState(!!openNow)
  /** Multi-select for bulk assignment (Lovable parity: BulkAssign). */
  const [userIds, setUserIds] = useState<string[]>([])
  const [shootId, setShootId] = useState(prefill?.id ?? '')
  const [service, setService] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [cost, setCost] = useState('')
  const [error, setError] = useState<string | null>(null)

  function toggleUser(id: string) {
    setUserIds((prev) => (prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]))
  }

  const shoot = shoots.find((s) => s.id === shootId) ?? null
  const shootDate = shoot?.shoot_date ?? null

  // A known shoot day is a starting point for the window — a shoot day runs
  // long here, and the two fields stay editable.
  useEffect(() => {
    if (!open || !shootDate) return
    setStart((v) => v || `${shootDate}T10:00`)
    setEnd((v) => v || `${shootDate}T22:00`)
  }, [open, shootDate])

  // Assign is pressed to fill a gap, so open on the first role still short of
  // what the shoot asked for.
  const gap = useMemo(() => {
    if (!shoot) return null
    const booked = (slots.data ?? []).filter(
      (s) => s.shoot_id === shoot.id && s.status === 'booked',
    )
    const short = shoot.requirements.find(
      (r) => booked.filter((s) => same(s.service_name, r.name)).length < r.quantity,
    )
    return short?.name ?? null
  }, [shoot, slots.data])

  useEffect(() => {
    if (open && gap) setService((v) => v || gap)
  }, [open, gap])

  const conflicts = useMemo(() => {
    if (userIds.length === 0 || !start || !end) return []
    let startIso = ''
    let endIso = ''
    try {
      startIso = new Date(start).toISOString()
      endIso = new Date(end).toISOString()
    } catch {
      return []
    }
    const out: { userId: string; name: string; count: number }[] = []
    for (const uid of userIds) {
      const mine = (slots.data ?? []).filter((s) => s.user_id === uid && s.status === 'booked')
      let n = 0
      try {
        n = findConflicts({ start_at: startIso, end_at: endIso }, mine).length
      } catch {
        n = 0
      }
      if (n > 0) {
        out.push({
          userId: uid,
          name: (members.data ?? []).find((m) => m.user_id === uid)?.name ?? 'Member',
          count: n,
        })
      }
    }
    return out
  }, [userIds, start, end, slots.data, members.data])

  function change(next: boolean) {
    setOpen(next)
    if (!next) onClosed?.()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (userIds.length === 0) throw new Error('Pick at least one member.')
      let done = 0
      for (const uid of userIds) {
        const body: BookSlotRequest = {
          user_id: uid,
          shoot_id: shootId || null,
          service_name: service || undefined,
          start_at: new Date(start).toISOString(),
          end_at: new Date(end).toISOString(),
          estimated_cost: cost.trim() ? Number(cost) : undefined,
        }
        await book.mutateAsync(body)
        done += 1
      }
      toast.success(done === 1 ? 'Crew booked' : `${done} crew booked`)
      change(false)
      setUserIds([])
      setService('')
      setStart('')
      setEnd('')
      setCost('')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not book.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        title="Assign crew"
        description="Pick who, which shoot and when. A clash with an existing booking is refused."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Members ({userIds.length} selected)</Label>
            <div className="grid max-h-44 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {(members.data ?? []).map((m) => (
                <label key={m.user_id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                  <input
                    type="checkbox"
                    checked={userIds.includes(m.user_id)}
                    onChange={() => toggleUser(m.user_id)}
                  />
                  {m.name}
                </label>
              ))}
            </div>
            {(members.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">No active members found.</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Shoot</Label>
            <Select
              value={shootId}
              onChange={(e) => {
                setShootId(e.target.value)
                setService('')
              }}
            >
              <option value="">No particular shoot</option>
              {shoots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shoot_date ? `${s.shoot_date} · ` : ''}
                  {s.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Input
              value={service}
              onChange={(e) => setService(e.target.value)}
              list="booking-roles"
              placeholder={shoot?.requirements[0]?.name ?? 'Candid Photographer'}
            />
            <datalist id="booking-roles">
              {(shoot?.requirements ?? []).map((r) => (
                <option key={r.service_id} value={r.name} />
              ))}
            </datalist>
            {shoot && shoot.requirements.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Match one of the shoot&rsquo;s roles and the booking counts against it.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Start</Label>
              <Input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End</Label>
              <Input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Estimated cost (₹)</Label>
            <Input
              inputMode="numeric"
              placeholder="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>

          {conflicts.length > 0 && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              Overlapping bookings: {conflicts.map((c) => `${c.name} (${c.count})`).join(', ')}.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={book.isPending || conflicts.length > 0 || userIds.length === 0}>
              <CalendarClock /> {book.isPending ? 'Booking…' : userIds.length > 1 ? `Book ${userIds.length}` : 'Book'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
