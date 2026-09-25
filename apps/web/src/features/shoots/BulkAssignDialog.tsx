import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarX, CheckCircle2, Clock, Lightbulb, Loader2, MapPin, Search, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { shootListItem, type ShootListItem, type SlotCostStatus } from '@ipc/contracts'
import { useQuery } from '@tanstack/react-query'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { Avatar } from '@/shared/ui/avatar'
import { cn } from '@/shared/ui/cn'
import { useBookSlots, useMembers, useSlots } from '@/features/allocation/api'
import {
  clashFor,
  defaultWindowFields,
  isLive,
  overlaps,
  payBasisLabel,
  requirementFill,
  suggestedPayout,
  windowOf,
  type TimeWindow,
} from './assign'

const list = shootListItem.array()

interface Row {
  time: string
  hours: number
  cost: string
  costStatus: SlotCostStatus
}

type RowState = 'ok' | 'conflict' | 'batch' | 'no_time' | 'full' | 'already'

interface Cand {
  shoot: ShootListItem
  required: number
  assigned: number
  open: number
  window: TimeWindow | null
  already: boolean
  clash: { name: string; start_at: string; end_at: string } | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Bulk assign: one person onto many shoots.
 *
 * The everyday case is a regular second shooter who does every Candid seat a
 * studio has this month, or every day of one wedding. One by one that is a
 * dozen trips through the assign dialog; here it is: pick the person, pick
 * the role, and every shoot in the range that needs that role is listed by
 * date -- with whether they can take it (free, already booked elsewhere at
 * that time, already on it, seat already filled), a suggested start time when
 * they clash, and per-shoot hours and payout. Tick, and book them together.
 *
 * A travel/rest buffer is applied between bookings, so two shoots on the same
 * day are allowed only when there is time to get from one to the other.
 */
export function BulkAssignDialog({ projectId, onClose }: { projectId?: string | undefined; onClose: () => void }) {
  const { session } = useAuth()
  const members = useMembers()
  const slots = useSlots()
  const book = useBookSlots()
  const shoots = useQuery({
    queryKey: projectId ? ['shoots', 'project', projectId] : ['shoots', 'all'],
    queryFn: () => callApi(projectId ? `/shoots?project_id=${projectId}` : '/shoots', { responseSchema: list }),
    enabled: !!session,
    staleTime: 15_000,
  })

  const range = useMemo(() => {
    const dated = (shoots.data ?? []).map((s) => s.shoot_date).filter((d): d is string => !!d).sort()
    if (projectId && dated.length) return { from: dated[0]!, to: dated[dated.length - 1]! }
    const now = new Date()
    return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  }, [shoots.data, projectId])

  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const dateFrom = from ?? range.from
  const dateTo = to ?? range.to
  const [memberId, setMemberId] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [role, setRole] = useState('')
  const [bufferMin, setBufferMin] = useState(60)
  const [defaultHours, setDefaultHours] = useState(4)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [showBlocked, setShowBlocked] = useState(false)
  // Ticked shoots and their times and payouts survive a refresh or a closed
  // tab until they are booked. Kept once at least one shoot is ticked.
  const draft = useFormDraft(
    `bulk-assign:${projectId ?? 'all'}`,
    { from, to, memberId, role, bufferMin, defaultHours, picked: [...picked], rows },
    (v) => {
      setFrom(v.from)
      setTo(v.to)
      setMemberId(v.memberId)
      setRole(v.role)
      setBufferMin(v.bufferMin)
      setDefaultHours(v.defaultHours)
      setPicked(new Set(v.picked))
      setRows(v.rows)
    },
    { isBlank: (v) => v.picked.length === 0 },
  )

  const all = slots.data ?? []
  const member = (members.data ?? []).find((m) => m.user_id === memberId) ?? null
  const inRange = (shoots.data ?? []).filter(
    (s) => s.status !== 'cancelled' && s.shoot_date && s.shoot_date >= dateFrom && s.shoot_date <= dateTo,
  )
  const roles = [...new Set(inRange.flatMap((s) => s.requirements.map((r) => r.name)))].sort((a, b) => a.localeCompare(b))

  const rowOf = (s: ShootListItem): Row => {
    const d = defaultWindowFields(s)
    return rows[s.id] ?? { time: d.time, hours: s.start_at ? d.hours : defaultHours, cost: '', costStatus: 'tentative' }
  }

  const cands: Cand[] = useMemo(() => {
    if (!member || !role) return []
    const out: Cand[] = []
    for (const s of inRange) {
      const req = s.requirements.find((r) => r.name.toLowerCase() === role.toLowerCase())
      if (!req) continue
      const shootSlots = all.filter((x) => x.shoot_id === s.id && isLive(x))
      const f = requirementFill({ requirements: [req] }, shootSlots)[0]!
      const already = shootSlots.some(
        (x) => x.user_id === member.user_id && (x.service_name ?? '').toLowerCase() === role.toLowerCase(),
      )
      const r = rowOf(s)
      const w = windowOf(defaultWindowFields(s).date, r.time, r.hours)
      const hit = w ? clashFor(member.user_id, w, all, { bufferMin }) : null
      const hitShoot = hit ? (shoots.data ?? []).find((x) => x.id === hit.shoot_id) : null
      out.push({
        shoot: s,
        required: f.required,
        assigned: f.assigned,
        open: f.open,
        window: w,
        already,
        clash: hit ? { name: hitShoot?.name ?? hit.service_name ?? 'another booking', start_at: hit.start_at, end_at: hit.end_at } : null,
      })
    }
    return out.sort(
      (a, b) =>
        (a.shoot.shoot_date ?? '').localeCompare(b.shoot.shoot_date ?? '') ||
        (a.window?.start ?? '').localeCompare(b.window?.start ?? ''),
    )
  }, [member, role, inRange, all, rows, bufferMin, defaultHours, shoots.data])

  // Two ticked shoots that clash with each other (same day, too close).
  const batchClash = useMemo(() => {
    const sel = cands.filter((c) => picked.has(c.shoot.id) && c.window)
    const bad = new Set<string>()
    for (let i = 0; i < sel.length; i++)
      for (let j = i + 1; j < sel.length; j++)
        if (overlaps(sel[i]!.window!, sel[j]!.window!, bufferMin)) {
          bad.add(sel[i]!.shoot.id)
          bad.add(sel[j]!.shoot.id)
        }
    return bad
  }, [cands, picked, bufferMin])

  const stateOf = (c: Cand): RowState =>
    c.already ? 'already' : c.open <= 0 ? 'full' : !c.window ? 'no_time' : c.clash ? 'conflict' : batchClash.has(c.shoot.id) ? 'batch' : 'ok'
  const blocked = (c: Cand) => c.already || c.open <= 0 || !c.window || !!c.clash
  const available = cands.filter((c) => !blocked(c))
  const unavailable = cands.filter(blocked)
  const ready = cands.filter((c) => picked.has(c.shoot.id) && stateOf(c) === 'ok')

  const patchRow = (s: ShootListItem, p: Partial<Row>) => setRows((prev) => ({ ...prev, [s.id]: { ...rowOf(s), ...p } }))

  function pickMember(id: string) {
    setMemberId(id)
    setPicked(new Set())
    const m = (members.data ?? []).find((x) => x.user_id === id)
    const rate = m ? suggestedPayout(m) : null
    // Their saved rate pre-fills every row; each can still be changed.
    setRows(() => {
      if (rate == null) return {}
      const next: Record<string, Row> = {}
      for (const s of inRange) next[s.id] = { ...rowOf(s), cost: String(rate) }
      return next
    })
  }

  async function submit() {
    if (!member || ready.length === 0) return
    const items = ready.map((c) => {
      const r = rowOf(c.shoot)
      const amount = r.cost.trim() ? Number(r.cost) : undefined
      return {
        user_id: member.user_id,
        shoot_id: c.shoot.id,
        service_name: c.shoot.requirements.find((x) => x.name.toLowerCase() === role.toLowerCase())?.name ?? role,
        start_at: c.window!.start,
        end_at: c.window!.end,
        ...(amount !== undefined && Number.isFinite(amount) && amount >= 0 ? { estimated_cost: amount } : {}),
        cost_status: r.costStatus,
      }
    })
    try {
      const { results } = await book.mutateAsync(items)
      const ok = results.filter((r) => r.id).length
      const skipped = results.length - ok
      if (ok > 0) toast.success(`${member.name} assigned to ${ok} shoot${ok === 1 ? '' : 's'}.${skipped ? ` ${skipped} could not be booked.` : ''}`)
      else toast.error('None of those could be booked — they clash with other bookings.')
      if (ok > 0 && skipped === 0) draft.clear()
      setPicked(new Set(results.filter((r) => !r.id).map((r) => ready[r.index]!.shoot.id)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not book these.')
    }
  }

  const q = memberSearch.trim().toLowerCase()
  const memberList = (members.data ?? []).filter(
    (m) => !q || m.name.toLowerCase().includes(q) || m.role_names.some((r) => r.toLowerCase().includes(q)),
  )

  const byDate = (xs: Cand[]) => {
    const m = new Map<string, Cand[]>()
    for (const c of xs) m.set(c.shoot.shoot_date ?? '', [...(m.get(c.shoot.shoot_date ?? '') ?? []), c])
    return [...m.entries()]
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-4xl"
        title="Bulk assign a team member"
        description="Pick a person and a role — every shoot that needs that role is listed by date. Tick the ones they should do and book them together."
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-member" className="text-xs">
                1. Team member
              </Label>
              {member ? (
                <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                  <Avatar name={member.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{member.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {payBasisLabel(member) ?? (member.role_names.join(', ') || 'Team member')}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMemberId('')}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="bulk-member"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search team member"
                      className="pl-8"
                    />
                  </div>
                  <ul className="max-h-40 overflow-y-auto rounded-md border border-border p-1">
                    {memberList.length === 0 && <li className="p-2 text-xs text-muted-foreground">No one found.</li>}
                    {memberList.map((m) => (
                      <li key={m.user_id}>
                        <button
                          type="button"
                          onClick={() => pickMember(m.user_id)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                        >
                          <Avatar name={m.name} size="sm" />
                          <span className="min-w-0 flex-1 truncate">{m.name}</span>
                          <span className="truncate text-[11px] text-muted-foreground">{m.role_names.join(', ')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-role" className="text-xs">
                2. Role
              </Label>
              <Select
                id="bulk-role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value)
                  setPicked(new Set())
                }}
              >
                <option value="">{roles.length === 0 ? 'No roles needed in these dates' : 'Pick a role'}</option>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bulk-from" className="text-[11px] text-muted-foreground">
                    From
                  </Label>
                  <Input id="bulk-from" type="date" value={dateFrom} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bulk-to" className="text-[11px] text-muted-foreground">
                    To
                  </Label>
                  <Input id="bulk-to" type="date" value={dateTo} onChange={(e) => setTo(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bulk-buffer" className="text-[11px] text-muted-foreground">
                    Travel / rest gap (min)
                  </Label>
                  <Input
                    id="bulk-buffer"
                    type="number"
                    min={0}
                    max={720}
                    value={bufferMin}
                    onChange={(e) => setBufferMin(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bulk-dur" className="text-[11px] text-muted-foreground">
                    Default hours
                  </Label>
                  <Input
                    id="bulk-dur"
                    type="number"
                    min={1}
                    max={24}
                    value={defaultHours}
                    onChange={(e) => setDefaultHours(Number(e.target.value) || 4)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="size-2 rounded-full bg-success" /> Available: {available.length}
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-muted-foreground/60" /> Unavailable: {unavailable.length}
                </span>
              </div>
              {available.length > 0 && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPicked(new Set(available.map((c) => c.shoot.id)))}>
                    Select all available
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPicked(new Set())}>
                    Clear
                  </Button>
                </div>
              )}
            </div>
            <div className="p-2">
              {shoots.isLoading || members.isLoading || slots.isLoading ? (
                <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading shoots…
                </p>
              ) : !member || !role ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Pick a team member and a role to see their shoots.</p>
              ) : cands.length === 0 ? (
                <div className="py-8 text-center">
                  <CalendarX className="mx-auto size-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm font-medium">No shoots need “{role}” in these dates</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {available.length === 0 && (
                    <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                      {member.name} cannot take any of these — every one is filled, already theirs, or clashes. See below.
                    </p>
                  )}
                  {byDate(available).map(([day, cs]) => (
                    <div key={`a-${day}`}>
                      <h3 className="px-1 pb-1.5 text-sm font-semibold">
                        {fmtDay(day)} <span className="font-normal text-muted-foreground">· {cs.length} available</span>
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {cs.map((c) => (
                          <CandRow
                            key={c.shoot.id}
                            c={c}
                            state={stateOf(c)}
                            row={rowOf(c.shoot)}
                            checked={picked.has(c.shoot.id)}
                            bufferMin={bufferMin}
                            onToggle={() =>
                              setPicked((p) => {
                                const n = new Set(p)
                                if (n.has(c.shoot.id)) n.delete(c.shoot.id)
                                else n.add(c.shoot.id)
                                return n
                              })
                            }
                            onRow={(p) => patchRow(c.shoot, p)}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                  {unavailable.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <button
                        type="button"
                        onClick={() => setShowBlocked((v) => !v)}
                        className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50"
                      >
                        {showBlocked ? 'Hide' : 'Show'} unavailable shoots ({unavailable.length})
                      </button>
                      {showBlocked &&
                        byDate(unavailable).map(([day, cs]) => (
                          <div key={`u-${day}`} className="mt-2">
                            <h3 className="px-1 pb-1.5 text-sm font-semibold text-foreground/80">{fmtDay(day)}</h3>
                            <ul className="flex flex-col gap-2">
                              {cs.map((c) => (
                                <CandRow
                                  key={c.shoot.id}
                                  c={c}
                                  state={stateOf(c)}
                                  row={rowOf(c.shoot)}
                                  checked={false}
                                  disabled
                                  bufferMin={bufferMin}
                                  onToggle={() => {}}
                                  onRow={(p) => patchRow(c.shoot, p)}
                                />
                              ))}
                            </ul>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <p className="mr-auto self-center text-xs text-muted-foreground">
            {ready.length > 0 ? `${ready.length} shoot${ready.length === 1 ? '' : 's'} ready to book` : 'Tick the shoots to assign'}
          </p>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={ready.length === 0 || book.isPending} onClick={() => void submit()}>
            {book.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Assign selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const BADGE: Record<RowState, { label: string; cls: string }> = {
  ok: { label: 'Available', cls: 'border-success/40 bg-success/10 text-success' },
  conflict: { label: 'Clashes', cls: 'border-destructive/40 bg-destructive/10 text-destructive' },
  batch: { label: 'Overlaps another ticked shoot', cls: 'border-warning/40 bg-warning/10 text-warning' },
  no_time: { label: 'Add a start time', cls: 'border-warning/40 bg-warning/10 text-warning' },
  full: { label: 'Seats filled', cls: 'border-border bg-muted text-muted-foreground' },
  already: { label: 'Already assigned', cls: 'border-border bg-muted text-muted-foreground' },
}

function CandRow({
  c,
  state,
  row,
  checked,
  disabled,
  bufferMin,
  onToggle,
  onRow,
}: {
  c: Cand
  state: RowState
  row: Row
  checked: boolean
  disabled?: boolean
  bufferMin: number
  onToggle: () => void
  onRow: (p: Partial<Row>) => void
}) {
  const tone =
    state === 'ok'
      ? 'border-success/30 bg-success/[0.04]'
      : state === 'conflict'
        ? 'border-destructive/30 bg-destructive/[0.04]'
        : state === 'batch' || state === 'no_time'
          ? 'border-warning/30 bg-warning/[0.04]'
          : 'border-border bg-muted/40'
  const locked = state === 'full' || state === 'already'
  const suggested = c.clash ? fmtTime(new Date(Date.parse(c.clash.end_at) + bufferMin * 60_000).toISOString()) : null
  return (
    <li className={cn('rounded-md border p-3', tone)}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Assign to ${c.shoot.name}`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 text-sm">
              <span className="font-semibold">{c.shoot.name}</span>
              {c.shoot.project_name && (
                <span className="text-xs text-muted-foreground">
                  {' '}
                  · {c.shoot.project_name}
                  {c.shoot.client_name ? ` · ${c.shoot.client_name}` : ''}
                </span>
              )}
            </p>
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', BADGE[state].cls)}>
              {state === 'ok' ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
              {BADGE[state].label}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {c.window && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <Clock className="size-3.5 text-muted-foreground" /> {fmtTime(c.window.start)} – {fmtTime(c.window.end)}
              </span>
            )}
            {c.shoot.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" /> {c.shoot.location}
              </span>
            )}
            <span>
              {c.assigned}/{c.required} assigned
            </span>
          </div>
          {state === 'conflict' && c.clash && (
            <div className="rounded-md border border-destructive/30 bg-destructive/[0.06] p-2 text-xs">
              <p className="font-medium text-destructive">
                Clashes with {c.clash.name}: {fmtTime(c.clash.start_at)} – {fmtTime(c.clash.end_at)}
                {bufferMin > 0 ? ` (+${bufferMin} min gap)` : ''}
              </p>
              {suggested && (
                <p className="mt-0.5 inline-flex items-center gap-1">
                  <Lightbulb className="size-3 text-warning" /> Try a start after {suggested}, or fewer hours.
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Start</Label>
              <Input type="time" className="h-8" value={row.time} disabled={locked} onChange={(e) => onRow({ time: e.target.value })} />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Hours</Label>
              <Input
                type="number"
                min={0.5}
                step={0.5}
                className="h-8"
                value={row.hours}
                disabled={locked}
                onChange={(e) => onRow({ hours: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Payout ₹</Label>
              <Input
                inputMode="decimal"
                className="h-8"
                placeholder="0"
                value={row.cost}
                disabled={locked}
                onChange={(e) => onRow({ cost: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Payout status</Label>
              <Select
                className="h-8"
                value={row.costStatus}
                disabled={locked}
                onChange={(e) => onRow({ costStatus: e.target.value as SlotCostStatus })}
              >
                <option value="tentative">Tentative</option>
                <option value="final">Final</option>
                <option value="not_decided">Not decided</option>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}
