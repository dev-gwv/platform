import { useMemo, useState, type FormEvent } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { todayInIndia } from '@/shared/ui/days-left'
import { ApiError } from '@/shared/api/client'
import {
  useTeamPayouts,
  useCreateTeamPayout,
  useUpdateTeamPayout,
  useUpdatePayoutStatus,
  useDeleteTeamPayout,
  usePayoutSettlements,
  useCreatePayoutSettlement,
} from '@/features/team-payouts/api'
import { useCrewPayouts } from '@/features/team-payouts/pay'
import { CREW_VIEWS, crewRowLine, crewRowsFor, crewViewOf } from '@/features/team-payouts/crew-view'
import { useDirectory } from '@/features/team/api'
import { PayToCard } from '@/features/team/PayToCard'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import { formatINR, humanize } from '@/shared/ui/format'
import { type CreateTeamPayoutRequest, type CrewPayoutRow, type PayoutEntryType, type TeamPayout } from '@ipc/contracts'
import { Plus, Trash2, Pencil, IndianRupee, Clock, CheckCircle, Download, History, ListChecks, Wallet, CalendarClock, Filter } from 'lucide-react'
import { downloadCsv, toCsv } from '@/shared/ui/csv'

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
  const [tab, setTab] = useState<'manual' | 'shoots'>('shoots')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateTeamPayoutRequest>(emptyForm())
  // Kept separate from `form.amount` (a number, for the request body) so the
  // field displays exactly what was typed instead of fighting a
  // type="number" input's leading-zero quirks.
  const [amountText, setAmountText] = useState('')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(dialogOpen ? `team-payout:${editingId ?? 'new'}` : null, { form, amountText }, (v) => {
    setForm(v.form)
    setAmountText(v.amountText)
  })

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

  function onSaved() {
    draft.clear()
    setDialogOpen(false)
  }

  function handleSubmit() {
    if (!form.user_id || form.amount <= 0 || !form.period_start || !form.period_end) return
    if (editingId) {
      const { user_id: _user_id, ...patch } = form
      updatePayout.mutate({ id: editingId, patch }, { onSuccess: onSaved })
    } else {
      createPayout.mutate(form, { onSuccess: onSaved })
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
          onClick={() => setTab('shoots')}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'shoots' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
        >
          Shoot payouts
        </button>
        <button
          type="button"
          onClick={() => setTab('manual')}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'manual' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
        >
          Other payouts
        </button>
      </div>

      {tab === 'shoots' && <ShootPayoutsTracker />}
      {tab === 'manual' && (
        <>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Payouts" value={summary.total_payouts} icon={ListChecks} />
          <StatCard label="Total Amount" value={`₹${summary.total_amount.toLocaleString()}`} icon={IndianRupee} />
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

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

type SettlementEntry = {
  id: string
  slot_id: string
  entry_type: string
  amount_paid: number
  paid_date: string
  payment_mode: string | null
  payment_reference: string | null
  notes: string | null
}

/**
 * Crew money by when the shoot is: Owed now (shoots already done, minus what
 * has been paid), Upcoming (promised, not owed yet) and All. The headline is
 * the same sum the dashboard's "Who you owe" shows (GET /team-payouts/shoots
 * and /owed read one query).
 */
function ShootPayoutsTracker() {
  const q = useCrewPayouts()
  const [viewParam, setViewParam] = useUrlParam('view', 'owed')
  const view = crewViewOf(viewParam)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [project, setProject] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const rows = useMemo(() => q.data?.rows ?? [], [q.data])
  const today = q.data?.today ?? todayInIndia()
  const slotIds = useMemo(() => rows.map((r) => r.slot_id), [rows])
  const { data: settlements } = usePayoutSettlements(slotIds)
  const entries: readonly SettlementEntry[] = settlements?.entries ?? []

  const shown = useMemo(
    () => crewRowsFor(rows, view, today, { project, q: search, from, to }),
    [rows, view, today, project, search, from, to],
  )
  const owedCount = useMemo(() => crewRowsFor(rows, 'owed', today).length, [rows, today])
  const projects = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) if (r.project_id) m.set(r.project_id, r.project_name ?? 'Project')
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])
  const filtering = !!(project || search.trim() || from || to)

  function exportCsv() {
    const lines = shown.map((r) => [
      r.user_name ?? '',
      r.project_name ?? '',
      r.shoot_name ?? '',
      r.shoot_date,
      r.role ?? '',
      r.amount,
      r.paid,
      Math.max(0, r.amount - r.paid),
      crewRowLine(r, today),
    ])
    downloadCsv(
      `shoot-payouts-${view}-${today}.csv`,
      toCsv(['Person', 'Project', 'Shoot', 'Date', 'Role', 'Payout', 'Paid', 'Left', 'Status'], lines),
    )
  }

  if (q.isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No bookings yet. Book crew on a shoot to see payouts here.
      </div>
    )
  }

  const byMember = new Map<string, CrewPayoutRow[]>()
  for (const r of shown) {
    const list = byMember.get(r.user_id) ?? []
    list.push(r)
    byMember.set(r.user_id, list)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Owed now"
          value={formatINR(q.data.owed_now)}
          icon={Clock}
          hint="Shoots already done, minus what you've paid."
        />
        <StatCard
          label="Paid"
          value={formatINR(q.data.paid)}
          icon={CheckCircle}
          hint={q.data.paid_ahead > 0 ? `${formatINR(q.data.paid_ahead)} of it in advance` : undefined}
        />
        <StatCard
          label="Upcoming"
          value={formatINR(q.data.upcoming)}
          icon={CalendarClock}
          hint="Promised for future shoots. Not owed yet."
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SectionTabs
          variant="chips"
          label="Which payouts"
          tabs={CREW_VIEWS.map((v) => ({ value: v.key, label: v.label, ...(v.key === 'owed' ? { count: owedCount } : {}) }))}
          value={view}
          onChange={(v) => setViewParam(v)}
        />
        <div className="ml-auto flex gap-2">
          <Button variant={filtersOpen || filtering ? 'default' : 'outline'} size="sm" onClick={() => setFiltersOpen((o) => !o)}>
            <Filter className="mr-1 h-4 w-4" /> Filter
          </Button>
          {shown.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
          )}
        </div>
      </div>

      {filtersOpen && (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label>Person</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
                <option value="">All projects</option>
                {projects.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Shoots from</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Shoots to</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </CardContent>
        </Card>
      )}

      {shown.length === 0 ? (
        view === 'owed' && !filtering ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-4 text-sm">
            <CheckCircle className="size-5 text-success" aria-hidden /> All crew paid for shoots already done.
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground">
            {filtering ? 'Nothing matches these filters.' : 'No shoots coming up.'}
          </div>
        )
      ) : (
        <div className="space-y-4">
          {[...byMember.entries()].map(([userId, list]) => {
            const left = list.reduce((n, r) => n + Math.max(0, r.amount - r.paid), 0)
            return (
              <div key={userId} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{list[0]!.user_name ?? 'Member'}</h3>
                  <p className="text-sm text-muted-foreground">
                    {left > 0
                      ? `${formatINR(left)} ${view === 'upcoming' ? 'after the shoots' : view === 'owed' ? 'owed' : 'left'}`
                      : 'All paid'}
                    {' · '}
                    {list.length} {list.length === 1 ? 'shoot' : 'shoots'}
                  </p>
                </div>
                {list.map((r) => (
                  <CrewPayoutLine key={r.slot_id} row={r} today={today} entries={entries} />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CrewPayoutLine({ row, today, entries }: { row: CrewPayoutRow; today: string; entries: readonly SettlementEntry[] }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const left = Math.max(0, row.amount - row.paid)
  const mine = entries.filter((e) => e.slot_id === row.slot_id)
  const past = row.shoot_date < today
  const settled = row.amount > 0 && left <= 0.001

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3', settled && 'bg-success/[0.06]')}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{[row.project_name, row.shoot_name].filter(Boolean).join(' · ') || 'A shoot'}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {[dayLabel(row.shoot_date), row.role].filter(Boolean).join(' · ')}
          {row.stands && row.amount > 0 && row.cost_status !== 'final' && ' · amount may change'}
        </p>
      </div>
      <p className={cn('text-sm tabular-nums', past && left > 0.001 ? 'font-semibold text-warning' : 'text-muted-foreground')}>
        {crewRowLine(row, today)}
      </p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" title="History" onClick={() => setHistoryOpen(true)} disabled={mine.length === 0}>
          <History className="h-4 w-4" />
        </Button>
        {row.stands && row.amount > 0 && left > 0.001 && (
          <MarkPaidDialog slotId={row.slot_id} userId={row.user_id} pending={left} solid={past} />
        )}
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent title="Payment history" description={[row.user_name, row.shoot_name].filter(Boolean).join(' · ') || undefined}>
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

const ENTRY_TYPES: readonly { value: PayoutEntryType; label: string; title: string }[] = [
  { value: 'payment', label: 'Payment', title: 'Money paid to them' },
  { value: 'reversal', label: 'Reversal', title: 'Correct an overpayment' },
  { value: 'adjustment', label: 'Adjustment', title: 'Any other correction' },
]

/** Amount defaults to the outstanding balance, but stays editable -- a partial payment is the norm, not an edge case. */
function MarkPaidDialog({ slotId, userId, pending, solid }: { slotId: string; userId: string; pending: number; solid?: boolean }) {
  const create = useCreatePayoutSettlement()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(pending))
  const [paidOn, setPaidOn] = useState(() => todayInIndia())
  const [mode, setMode] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [entryType, setEntryType] = useState<PayoutEntryType>('payment')
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `payout-settlement:${slotId}` : null,
    { amount, paidOn, mode, reference, notes, entryType },
    (v) => {
      setAmount(v.amount)
      setPaidOn(v.paidOn)
      setMode(v.mode)
      setReference(v.reference)
      setNotes(v.notes)
      setEntryType(v.entryType)
    },
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const value = Number(amount)
    if (!(value > 0)) return
    try {
      await create.mutateAsync({
        slot_id: slotId,
        amount_paid: value,
        paid_date: paidOn,
        payment_mode: mode || undefined,
        payment_reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        entry_type: entryType,
      })
      draft.clear()
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not record this settlement.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={solid ? 'default' : 'outline'}>
          <Wallet className="mr-1 h-4 w-4" /> Pay
        </Button>
      </DialogTrigger>
      <DialogContent title="Record a settlement" description={`Outstanding: ${formatINR(pending)}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {open && <PayToCard userId={userId} />}
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
            <div role="radiogroup" aria-label="Type" className="flex flex-wrap gap-2">
              {ENTRY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={entryType === t.value}
                  title={t.title}
                  onClick={() => setEntryType(t.value)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                    entryType === t.value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-muted',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
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
