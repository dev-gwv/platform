import { useState } from 'react'
import { CalendarOff, Check, Clock3, Plus, Trash2, X } from 'lucide-react'
import type { AttendanceCorrection, LeaveKind, LeaveRequest } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import {
  useAddHoliday,
  useAskCorrection,
  useAskLeave,
  useCanDecide,
  useCancelLeave,
  useCorrections,
  useDecideCorrection,
  useDecideLeave,
  useHolidays,
  useLeave,
  usePolicy,
  useRemoveHoliday,
  useSetWeeklyOff,
} from '@/features/hr/leave-api'

export function LeavePage() {
  return (
    <AuthedPage module="dashboard">
      <Leave />
    </AuthedPage>
  )
}

type Tab = 'mine' | 'approvals' | 'holidays'

const KIND_LABEL: Record<LeaveKind, string> = {
  casual: 'Casual',
  sick: 'Sick',
  paid: 'Paid',
  unpaid: 'Unpaid',
  other: 'Other',
}
const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' } as const
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
const span = (l: Pick<LeaveRequest, 'start_date' | 'end_date' | 'half_day'>) =>
  (l.end_date > l.start_date ? `${day(l.start_date)} – ${day(l.end_date)}` : day(l.start_date)) + (l.half_day ? ' · half day' : '')
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—')
/** Today where the studio is (India). */
const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)

/**
 * Days off, all in one place: ask for leave, fix a day you forgot to check in,
 * and -- for whoever runs the team -- approve both and keep the holiday list.
 * A holiday, a weekly off or approved leave is never marked absent.
 */
function Leave() {
  const canDecide = useCanDecide()
  const [tab, setTab] = useUrlParam('tab', 'mine')
  const pendingLeave = useLeave('team', 'pending')
  const pendingFixes = useCorrections('team', 'pending')
  const waiting = canDecide ? (pendingLeave.data ?? []).length + (pendingFixes.data ?? []).length : 0

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'mine', label: 'My leave' },
    ...(canDecide ? [{ value: 'approvals' as Tab, label: 'To approve', count: waiting }] : []),
    { value: 'holidays', label: 'Holidays' },
  ]
  const current = (tabs.some((t) => t.value === tab) ? tab : 'mine') as Tab

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Leave & holidays" description="Ask for days off, fix a missed check-in, and see the studio's holidays." />
      <FilterTabs<Tab> tabs={tabs} value={current} onChange={setTab} className="w-fit" />
      {current === 'mine' && <MyLeave />}
      {current === 'approvals' && canDecide && <Approvals />}
      {current === 'holidays' && <Holidays canEdit={canDecide} />}
    </section>
  )
}

// ── mine ─────────────────────────────────────────────────────────
function MyLeave() {
  const leave = useLeave('mine')
  const fixes = useCorrections('mine')
  const cancel = useCancelLeave()
  const confirm = useConfirm()
  const [asking, setAsking] = useState(false)
  const [fixing, setFixing] = useState(false)
  const today = todayIST()

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">My leave</h2>
            <Button size="sm" onClick={() => setAsking(true)}>
              <CalendarOff /> Ask for leave
            </Button>
          </div>
          {leave.isLoading ? (
            <SkeletonList rows={3} columns={2} />
          ) : !(leave.data ?? []).length ? (
            <p className="mt-3 text-sm text-muted-foreground">No leave asked for yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {(leave.data ?? []).map((l) => {
                const canCancel = l.status === 'pending' || (l.status === 'approved' && l.start_date > today)
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{span(l)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {KIND_LABEL[l.kind]}
                        {l.reason ? ` · ${l.reason}` : ''}
                        {l.decision_note ? ` · “${l.decision_note}”` : ''}
                      </p>
                    </div>
                    <StatusBadge tone={STATUS_TONE[l.status]}>{l.status === 'rejected' ? 'Not approved' : l.status[0]!.toUpperCase() + l.status.slice(1)}</StatusBadge>
                    {canCancel && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Cancel this leave"
                        onClick={async () => {
                          if (await confirm({ title: 'Cancel this leave?', description: span(l), confirmLabel: 'Cancel leave' })) cancel.mutate(l.id)
                        }}
                      >
                        <X />
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Fix a day</h2>
            <Button size="sm" variant="outline" onClick={() => setFixing(true)}>
              <Clock3 /> I forgot to check in
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Forgot to tap in, or your phone died? Ask here and your manager fixes the day.</p>
          {!(fixes.data ?? []).length ? (
            <p className="mt-3 text-sm text-muted-foreground">Nothing asked for.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {(fixes.data ?? []).map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {day(f.a_date)} · {time(f.check_in_at)} – {time(f.check_out_at)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {f.reason}
                      {f.decision_note ? ` · “${f.decision_note}”` : ''}
                    </p>
                  </div>
                  <StatusBadge tone={STATUS_TONE[f.status]}>{f.status === 'rejected' ? 'Not changed' : f.status[0]!.toUpperCase() + f.status.slice(1)}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {asking && <AskLeaveDialog onClose={() => setAsking(false)} />}
      {fixing && <FixDayDialog onClose={() => setFixing(false)} />}
    </div>
  )
}

function AskLeaveDialog({ onClose }: { onClose: () => void }) {
  const ask = useAskLeave()
  const today = todayIST()
  const [kind, setKind] = useState<LeaveKind>('casual')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [half, setHalf] = useState(false)
  const [reason, setReason] = useState('')
  const draft = useFormDraft('leave:new', { kind, from, to, half, reason }, (v) => {
    setKind(v.kind)
    setFrom(v.from)
    setTo(v.to)
    setHalf(v.half)
    setReason(v.reason)
  })
  const oneDay = from === to

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Ask for leave" description="Your manager is told straight away, and you hear back here.">
        <DraftRestoredBanner at={draft.restoredAt} onDismiss={draft.dismissRestored} onDiscard={() => draft.clear()} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lv-from">From</Label>
            <Input
              id="lv-from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                if (e.target.value > to) setTo(e.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lv-to">To</Label>
            <Input id="lv-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lv-kind">Type</Label>
            <Select id="lv-kind" value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)}>
              {(Object.keys(KIND_LABEL) as LeaveKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </div>
          <label className={cn('flex items-center gap-2 self-end pb-2 text-sm', !oneDay && 'opacity-50')}>
            <input type="checkbox" checked={half && oneDay} disabled={!oneDay} onChange={(e) => setHalf(e.target.checked)} /> Half day
          </label>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="lv-reason">Reason</Label>
            <Textarea id="lv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Family function, not well…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={ask.isPending || !from || !to}
            onClick={() =>
              ask.mutate(
                { kind, start_date: from, end_date: to, half_day: half && oneDay, reason: reason.trim() || null },
                {
                  onSuccess: () => {
                    draft.clear()
                    onClose()
                  },
                },
              )
            }
          >
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FixDayDialog({ onClose }: { onClose: () => void }) {
  const ask = useAskCorrection()
  const [date, setDate] = useState(todayIST())
  const [inAt, setInAt] = useState('10:00')
  const [outAt, setOutAt] = useState('19:00')
  const [reason, setReason] = useState('')
  const draft = useFormDraft('attendance-fix:new', { date, inAt, outAt, reason }, (v) => {
    setDate(v.date)
    setInAt(v.inAt)
    setOutAt(v.outAt)
    setReason(v.reason)
  })
  // The times are the studio's (India), whatever the phone's clock says.
  const iso = (hhmm: string) => `${date}T${hhmm}:00+05:30`

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Fix a day" description="Say when you really came and left. Your manager approves it.">
        <DraftRestoredBanner at={draft.restoredAt} onDismiss={draft.dismissRestored} onDiscard={() => draft.clear()} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fx-date">Day</Label>
            <Input id="fx-date" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fx-in">Came in</Label>
            <Input id="fx-in" type="time" value={inAt} onChange={(e) => setInAt(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fx-out">Left</Label>
            <Input id="fx-out" type="time" value={outAt} onChange={(e) => setOutAt(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-3">
            <Label htmlFor="fx-reason">What happened</Label>
            <Textarea id="fx-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Phone died at the gate…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={ask.isPending || reason.trim().length < 3 || !inAt}
            onClick={() =>
              ask.mutate(
                { a_date: date, check_in_at: iso(inAt), check_out_at: outAt ? iso(outAt) : null, reason: reason.trim() },
                {
                  onSuccess: () => {
                    draft.clear()
                    onClose()
                  },
                },
              )
            }
          >
            Send for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── approvals ────────────────────────────────────────────────────
function Approvals() {
  const leave = useLeave('team', 'pending')
  const fixes = useCorrections('team', 'pending')
  const decideLeave = useDecideLeave()
  const decideFix = useDecideCorrection()
  const [declining, setDeclining] = useState<{ kind: 'leave' | 'fix'; id: string; label: string } | null>(null)

  if (leave.isLoading || fixes.isLoading) return <SkeletonList rows={3} columns={3} />
  const nothing = !(leave.data ?? []).length && !(fixes.data ?? []).length

  return (
    <div className="flex flex-col gap-4">
      {nothing && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">Nothing waiting for you.</CardContent>
        </Card>
      )}
      {(leave.data ?? []).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold">Leave to approve</h2>
            <ul className="mt-2 divide-y divide-border">
              {(leave.data ?? []).map((l) => (
                <Row
                  key={l.id}
                  who={l.user_name}
                  what={`${span(l)} · ${KIND_LABEL[l.kind]}`}
                  why={l.reason}
                  busy={decideLeave.isPending}
                  onApprove={() => decideLeave.mutate({ id: l.id, approve: true, note: null })}
                  onDecline={() => setDeclining({ kind: 'leave', id: l.id, label: `${l.user_name ?? 'Leave'} · ${span(l)}` })}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {(fixes.data ?? []).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold">Attendance to fix</h2>
            <ul className="mt-2 divide-y divide-border">
              {(fixes.data ?? []).map((f: AttendanceCorrection) => (
                <Row
                  key={f.id}
                  who={f.user_name}
                  what={`${day(f.a_date)} · ${time(f.check_in_at)} – ${time(f.check_out_at)}`}
                  why={f.reason}
                  busy={decideFix.isPending}
                  onApprove={() => decideFix.mutate({ id: f.id, approve: true, note: null })}
                  onDecline={() => setDeclining({ kind: 'fix', id: f.id, label: `${f.user_name ?? 'Attendance'} · ${day(f.a_date)}` })}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {declining && (
        <DeclineDialog
          label={declining.label}
          onClose={() => setDeclining(null)}
          onDecline={(note) => {
            const m = declining.kind === 'leave' ? decideLeave : decideFix
            m.mutate({ id: declining.id, approve: false, note }, { onSuccess: () => setDeclining(null) })
          }}
        />
      )}
    </div>
  )
}

function Row({
  who,
  what,
  why,
  busy,
  onApprove,
  onDecline,
}: {
  who: string | null
  what: string
  why: string | null
  busy: boolean
  onApprove: () => void
  onDecline: () => void
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{who ?? 'Team member'}</p>
        <p className="truncate text-xs text-muted-foreground">
          {what}
          {why ? ` · ${why}` : ''}
        </p>
      </div>
      <Button size="sm" onClick={onApprove} disabled={busy}>
        <Check /> Approve
      </Button>
      <Button size="sm" variant="outline" onClick={onDecline} disabled={busy}>
        Decline
      </Button>
    </li>
  )
}

function DeclineDialog({ label, onClose, onDecline }: { label: string; onClose: () => void; onDecline: (note: string) => void }) {
  const [note, setNote] = useState('')
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Decline" description={label}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dc-note">Tell them why</Label>
          <Textarea id="dc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Wedding that week — can we move it?" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={note.trim().length < 3} onClick={() => onDecline(note.trim())}>
            Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── holidays ─────────────────────────────────────────────────────
function Holidays({ canEdit }: { canEdit: boolean }) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const holidays = useHolidays(year)
  const policy = usePolicy()
  const add = useAddHoliday()
  const remove = useRemoveHoliday()
  const setOff = useSetWeeklyOff()
  const confirm = useConfirm()
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const off = new Set(policy.data?.weekly_off ?? [])

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Holidays</h2>
            <Select aria-label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="h-8 w-28">
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          {canEdit && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Input aria-label="Holiday date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
              <Input aria-label="Holiday name" placeholder="Diwali" value={name} onChange={(e) => setName(e.target.value)} className="min-w-[10rem] flex-1" />
              <Button
                size="sm"
                disabled={!date || !name.trim() || add.isPending}
                onClick={() =>
                  add.mutate(
                    { holiday_date: date, name: name.trim() },
                    {
                      onSuccess: () => {
                        setDate('')
                        setName('')
                      },
                    },
                  )
                }
              >
                <Plus /> Add
              </Button>
            </div>
          )}
          {!(holidays.data ?? []).length ? (
            <p className="mt-3 text-sm text-muted-foreground">No holidays added for {year}.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {(holidays.data ?? []).map((h) => (
                <li key={h.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{day(h.holiday_date)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${h.name}`}
                      onClick={async () => {
                        if (await confirm({ title: `Remove ${h.name}?`, confirmLabel: 'Remove', destructive: true })) remove.mutate(h.id)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">Weekly off</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Nobody is marked absent on these days.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = off.has(i)
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!canEdit || setOff.isPending}
                  aria-pressed={on}
                  onClick={() => {
                    const next = new Set(off)
                    if (on) next.delete(i)
                    else next.add(i)
                    setOff.mutate([...next].sort())
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
                    !canEdit && 'cursor-default',
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
