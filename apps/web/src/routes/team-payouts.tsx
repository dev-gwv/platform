import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import { ApiError, callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { shootListItem } from '@ipc/contracts'
import {
  useTeamPayouts,
  useCreateTeamPayout,
  useUpdateTeamPayout,
  useUpdatePayoutStatus,
  useDeleteTeamPayout,
  usePayoutSettlements,
  useCreatePayoutSettlement,
} from '@/features/team-payouts/api'
import { useSlots } from '@/features/allocation/api'
import { useDirectory } from '@/features/team/api'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import { formatINR, humanize } from '@/shared/ui/format'
import { type CreateTeamPayoutRequest, type PayoutEntryType, type TeamPayout, type TeamSlot } from '@ipc/contracts'
import { Plus, Trash2, Pencil, DollarSign, Clock, CheckCircle, History, Wallet } from 'lucide-react'

const emptyForm = (): CreateTeamPayoutRequest => ({
  user_id: '',
  amount: 0,
  period_start: '',
  period_end: '',
  payment_mode: null,
  reference: null,
  notes: null,
})

function TeamPayoutsContent() {
  const [tab, setTab] = useState<'manual' | 'shoots'>('manual')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateTeamPayoutRequest>(emptyForm())
  // Kept separate from `form.amount` (a number, for the request body) so the
  // field displays exactly what was typed instead of fighting a
  // type="number" input's leading-zero quirks.
  const [amountText, setAmountText] = useState('')

  const { data } = useTeamPayouts()
  const { data: members } = useDirectory()
  const createPayout = useCreateTeamPayout()
  const updatePayout = useUpdateTeamPayout()
  const updateStatus = useUpdatePayoutStatus()
  const deletePayout = useDeleteTeamPayout()

  const items = data?.items ?? []
  const summary = data?.summary

  function startEdit(p: TeamPayout) {
    setEditingId(p.id)
    setForm({
      user_id: p.user_id,
      amount: p.amount,
      period_start: p.period_start,
      period_end: p.period_end,
      payment_mode: p.payment_mode,
      reference: p.reference,
      notes: p.notes,
    })
    setAmountText(String(p.amount))
    setDialogOpen(true)
  }

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setAmountText('')
    setDialogOpen(true)
  }

  function handleSubmit() {
    if (!form.user_id || form.amount <= 0 || !form.period_start || !form.period_end) return
    if (editingId) {
      const { user_id: _user_id, ...patch } = form
      updatePayout.mutate({ id: editingId, patch }, { onSuccess: () => setDialogOpen(false) })
    } else {
      createPayout.mutate(form, { onSuccess: () => setDialogOpen(false) })
    }
  }

  const statusTone: Record<string, 'warning' | 'info' | 'success' | 'danger'> = {
    pending: 'warning',
    processing: 'info',
    completed: 'success',
    failed: 'danger',
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Team Payouts"
        description="Manage team settlements and payments"
        actions={
          tab === 'manual' && (
            <Button onClick={openCreate} size="sm">
              <Plus className="mr-1 h-4 w-4" /> New Payout
            </Button>
          )
        }
      />

      <div className="flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('manual')}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'manual' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
        >
          Manual payouts
        </button>
        <button
          type="button"
          onClick={() => setTab('shoots')}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'shoots' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
        >
          From shoots
        </button>
      </div>

      {tab === 'shoots' && <ShootPayoutsTracker />}
      {tab === 'manual' && (
        <>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Payouts" value={summary.total_payouts} icon={DollarSign} />
          <StatCard label="Total Amount" value={`₹${summary.total_amount.toLocaleString()}`} icon={DollarSign} />
          <StatCard label="Pending" value={`₹${summary.pending_amount.toLocaleString()}`} icon={Clock} />
          <StatCard label="Completed" value={`₹${summary.completed_amount.toLocaleString()}`} icon={CheckCircle} />
        </div>
      )}

      <div className="space-y-2">
        {items.map((payout) => (
          <div
            key={payout.id}
            className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">₹{payout.amount.toLocaleString()}</span>
                <StatusBadge tone={statusTone[payout.status] ?? 'neutral'}>{humanize(payout.status)}</StatusBadge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {payout.user_name ?? 'Unknown'} · {payout.period_start} to {payout.period_end}
              </p>
              {payout.notes && (
                <p className="mt-1 text-xs text-muted-foreground">{payout.notes}</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Select value={payout.status} onChange={(e) => updateStatus.mutate({ id: payout.id, status: e.target.value })} className="w-32">
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </Select>
              {payout.status === 'pending' && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(payout)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
                <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => { if (confirm('Delete this payout?')) deletePayout.mutate(payout.id) }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">No payouts yet.</div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title={editingId ? 'Edit Payout' : 'New Payout'}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Team Member</label>
              <Select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} disabled={!!editingId}>
                <option value="">Select team member</option>
                {members?.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.name ?? m.email}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Amount (₹)</label>
              <Input
                inputMode="decimal"
                value={amountText}
                onChange={(e) => {
                  setAmountText(e.target.value)
                  setForm({ ...form, amount: Number(e.target.value) || 0 })
                }}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Period Start</label>
              <Input
                type="date"
                value={form.period_start}
                onChange={(e) => setForm({ ...form, period_start: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Period End</label>
              <Input
                type="date"
                value={form.period_end}
                onChange={(e) => setForm({ ...form, period_end: e.target.value })}
              />
            </div>
            <PaymentModePicker
              label="Payment Mode"
              value={form.payment_mode ?? ''}
              onChange={(v) => setForm({ ...form, payment_mode: v || null })}
            />
            <div>
              <label className="text-sm font-medium">Reference</label>
              <Input
                value={form.reference ?? ''}
                onChange={(e) => setForm({ ...form, reference: e.target.value || null })}
                placeholder="Transaction reference"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notes</label>
              <Input
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
                placeholder="Optional notes"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !form.user_id ||
                form.amount <= 0 ||
                !form.period_start ||
                !form.period_end ||
                createPayout.isPending ||
                updatePayout.isPending
              }
            >
              {editingId
                ? updatePayout.isPending
                  ? 'Saving...'
                  : 'Save changes'
                : createPayout.isPending
                  ? 'Creating...'
                  : 'Create Payout'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  )
}

const COST_STATUS_TONE = { not_decided: 'neutral', tentative: 'warning', final: 'success' } as const
const SETTLEMENT_TONE = { unpaid: 'danger', partially_paid: 'warning', paid: 'success' } as const

type SettlementFilter = 'all' | 'unpaid' | 'partially_paid' | 'paid'
type CostFilter = 'all' | 'final' | 'tentative' | 'not_added'
type RangeFilter = 'all' | 'this_month' | 'custom'

function settlementOf(due: number, paid: number): 'unpaid' | 'partially_paid' | 'paid' {
  if (paid <= 0) return 'unpaid'
  if (paid + 0.001 >= due) return 'paid'
  return 'partially_paid'
}

/** Grouped by member: what a shoot-day booking is worth, and what's actually been paid toward it. */
function ShootPayoutsTracker() {
  const { data: slots, isLoading } = useSlots()
  const { session } = useAuth()
  const access = useAccess()
  const [settlement, setSettlement] = useState<SettlementFilter>('all')
  const [cost, setCost] = useState<CostFilter>('all')
  const [range, setRange] = useState<RangeFilter>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')

  const shoots = useQuery({
    queryKey: ['shoots'],
    queryFn: () => callApi('/shoots', { responseSchema: shootListItem.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
  const shootById = useMemo(() => new Map((shoots.data ?? []).map((s) => [s.id, s])), [shoots.data])

  const bookable = useMemo(
    () => (slots ?? []).filter((s) => s.status !== 'cancelled'),
    [slots],
  )
  const slotIds = useMemo(() => bookable.map((s) => s.id), [bookable])
  const { data: settlements } = usePayoutSettlements(slotIds)
  const paidBySlot = useMemo(
    () => new Map((settlements?.aggregates ?? []).map((a) => [a.slot_id, a])),
    [settlements],
  )

  const { fromDate, toDate } = useMemo(() => {
    if (range === 'this_month') {
      const n = new Date()
      const pad = (v: number) => String(v).padStart(2, '0')
      return {
        fromDate: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`,
        toDate: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate())}`,
      }
    }
    return { fromDate: from || null, toDate: to || null }
  }, [range, from, to])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bookable.filter((s) => {
      const due = s.final_cost ?? s.estimated_cost ?? 0
      const paid = paidBySlot.get(s.id)?.paid_total ?? 0
      const uncosted = s.cost_status === 'not_decided' && due <= 0
      if (cost === 'final' && s.cost_status !== 'final') return false
      if (cost === 'tentative' && s.cost_status !== 'tentative') return false
      if (cost === 'not_added' && !uncosted) return false
      if (settlement !== 'all' && settlementOf(due, paid) !== settlement) return false
      if (fromDate && s.start_at.slice(0, 10) < fromDate) return false
      if (toDate && s.start_at.slice(0, 10) > toDate) return false
      if (q && !(s.user_name ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [bookable, paidBySlot, cost, settlement, fromDate, toDate, search])

  const summary = useMemo(() => {
    const due = filtered.reduce((n, s) => n + (s.final_cost ?? s.estimated_cost ?? 0), 0)
    const paid = filtered.reduce((n, s) => n + (paidBySlot.get(s.id)?.paid_total ?? 0), 0)
    const partial = filtered.filter((s) =>
      settlementOf(s.final_cost ?? s.estimated_cost ?? 0, paidBySlot.get(s.id)?.paid_total ?? 0) === 'partially_paid',
    ).length
    return {
      due,
      paid,
      pending: Math.max(0, due - paid),
      partial,
      members: new Set(filtered.map((s) => s.user_id)).size,
    }
  }, [filtered, paidBySlot])

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>
  if (bookable.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No bookings yet. Book crew in Team Allocation to see payouts here.
      </div>
    )
  }

  const byMember = new Map<string, TeamSlot[]>()
  for (const s of filtered) {
    const list = byMember.get(s.user_id) ?? []
    list.push(s)
    byMember.set(s.user_id, list)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total due" value={formatINR(summary.due)} icon={DollarSign} />
        <StatCard label="Paid" value={formatINR(summary.paid)} icon={CheckCircle} />
        <StatCard label="Pending" value={formatINR(summary.pending)} icon={Clock} />
        <StatCard label="Partially paid" value={String(summary.partial)} icon={Wallet} />
        <StatCard label="Members" value={String(summary.members)} icon={DollarSign} />
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <Label>Settlement</Label>
            <Select value={settlement} onChange={(e) => setSettlement(e.target.value as SettlementFilter)}>
              <option value="all">All</option>
              <option value="unpaid">Unpaid</option>
              <option value="partially_paid">Partially paid</option>
              <option value="paid">Paid</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Cost status</Label>
            <Select value={cost} onChange={(e) => setCost(e.target.value as CostFilter)}>
              <option value="all">All</option>
              <option value="final">Final</option>
              <option value="tentative">Tentative</option>
              <option value="not_added">Not added</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Date range</Label>
            <Select value={range} onChange={(e) => setRange(e.target.value as RangeFilter)}>
              <option value="all">All time</option>
              <option value="this_month">This month</option>
              <option value="custom">Custom</option>
            </Select>
          </div>
          {range === 'custom' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5 lg:col-span-2">
              <Label>Member</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" />
            </div>
          )}
          {range === 'custom' && (
            <div className="flex flex-col gap-1.5 lg:col-span-5">
              <Label>Member</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Two numbers on this screen look like they should agree with the
          project's cost and they do not. Saying so here is cheaper than the
          support conversation that follows when nobody does. */}
      <p className="text-xs text-muted-foreground">
        The settlement ledger tracks cash actually paid to team members. Project cost and profit still use
        the assignment payout amount, and are not affected by what has been settled here.
      </p>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          Nothing matches these filters.
        </div>
      ) : (
        <div className="space-y-4">
          {[...byMember.entries()].map(([userId, memberSlots]) => {
            const memberTotal = memberSlots.reduce((n, s) => n + (s.final_cost ?? s.estimated_cost ?? 0), 0)
            const memberPaid = memberSlots.reduce((n, s) => n + (paidBySlot.get(s.id)?.paid_total ?? 0), 0)
            return (
              <div key={userId} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold">{memberSlots[0]!.user_name ?? 'Member'}</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatINR(memberPaid)} of {formatINR(memberTotal)} paid
                  </p>
                </div>
                {memberSlots.map((s) => (
                  <SlotPayoutRow
                    key={s.id}
                    slot={s}
                    shootName={s.shoot_id ? (shootById.get(s.shoot_id)?.name ?? null) : null}
                    projectName={s.shoot_id ? (shootById.get(s.shoot_id)?.project_name ?? null) : null}
                    agg={paidBySlot.get(s.id)}
                    entries={settlements?.entries ?? []}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SlotPayoutRow({
  slot,
  shootName,
  projectName,
  agg,
  entries,
}: {
  slot: TeamSlot
  shootName: string | null
  projectName: string | null
  agg: { paid_total: number } | undefined
  entries: readonly { id: string; slot_id: string; entry_type: string; amount_paid: number; paid_date: string; payment_mode: string | null; payment_reference: string | null; notes: string | null }[]
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const due = slot.final_cost ?? slot.estimated_cost ?? 0
  const paid = agg?.paid_total ?? 0
  const pending = Math.max(0, due - paid)
  const uncosted = slot.cost_status === 'not_decided' && due <= 0
  const settlementStatus = uncosted ? 'unpaid' : settlementOf(due, paid)
  const mine = entries.filter((e) => e.slot_id === slot.id)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{slot.service_name ?? 'Booking'}</span>
          {uncosted ? (
            <StatusBadge>No cost yet</StatusBadge>
          ) : (
            <StatusBadge tone={COST_STATUS_TONE[slot.cost_status]}>{slot.cost_status.replace('_', ' ')}</StatusBadge>
          )}
          <StatusBadge tone={SETTLEMENT_TONE[settlementStatus]}>{settlementStatus.replace('_', ' ')}</StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {projectName ?? 'No project'} · {shootName ?? 'No shoot'}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {new Date(slot.start_at).toLocaleDateString()} · {uncosted ? 'uncosted' : `${formatINR(due)} due, ${formatINR(paid)} paid`}
        </p>
        {slot.cost_notes && <p className="mt-1 text-xs text-muted-foreground">{slot.cost_notes}</p>}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" title="History" onClick={() => setHistoryOpen(true)} disabled={mine.length === 0}>
          <History className="h-4 w-4" />
        </Button>
        {!uncosted && pending > 0.001 && <MarkPaidDialog slot={slot} pending={pending} />}
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent title="Settlement history" description={slot.service_name ?? undefined}>
          <div className="flex flex-col gap-2">
            {mine.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <p className="font-medium capitalize">{e.entry_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.paid_date}
                    {e.payment_mode ? ` · ${e.payment_mode}` : ''}
                    {e.payment_reference ? ` · ${e.payment_reference}` : ''}
                  </p>
                  {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
                </div>
                <span className={e.amount_paid < 0 ? 'text-destructive' : 'text-success'}>{formatINR(e.amount_paid)}</span>
              </div>
            ))}
            {mine.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Amount defaults to the outstanding balance, but stays editable -- a partial payment is the norm, not an edge case. */
function MarkPaidDialog({ slot, pending }: { slot: TeamSlot; pending: number }) {
  const create = useCreatePayoutSettlement()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(pending))
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [entryType, setEntryType] = useState<PayoutEntryType>('payment')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const value = Number(amount)
    if (!(value > 0)) return
    try {
      await create.mutateAsync({
        slot_id: slot.id,
        amount_paid: value,
        paid_date: paidOn,
        payment_mode: mode || undefined,
        payment_reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        entry_type: entryType,
      })
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not record this settlement.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Wallet className="mr-1 h-4 w-4" /> Mark paid
        </Button>
      </DialogTrigger>
      <DialogContent title="Record a settlement" description={`Outstanding: ${formatINR(pending)}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Amount (₹)</Label>
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select value={entryType} onChange={(e) => setEntryType(e.target.value as PayoutEntryType)}>
              <option value="payment">Payment</option>
              <option value="reversal">Reversal (correct an overpayment)</option>
              <option value="adjustment">Adjustment</option>
            </Select>
          </div>
          <PaymentModePicker value={mode} onChange={setMode} />
          <div className="flex flex-col gap-1.5">
            <Label>Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
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
            <Button type="submit" disabled={create.isPending || !(Number(amount) > 0)}>
              {create.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TeamPayoutsPage() {
  return (
    <AuthedPage module="team_payouts">
      <TeamPayoutsContent />
    </AuthedPage>
  )
}
