import { parseAmount } from '@/shared/money/parse-amount'
import { useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import {
  useTeamPayouts,
  useCreateTeamPayout,
  useUpdateTeamPayout,
  useUpdatePayoutStatus,
  useDeleteTeamPayout,
} from '@/features/team-payouts/api'
import { ShootPayoutsTracker } from '@/features/team-payouts/ShootPayoutsTracker'
import { useDirectory } from '@/features/team/api'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import { humanize } from '@/shared/ui/format'
import { type CreateTeamPayoutRequest, type TeamPayout } from '@ipc/contracts'
import { Plus, Trash2, Pencil, IndianRupee, Clock, CheckCircle, ListChecks } from 'lucide-react'

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
  // The same page is Money's "Crew payouts" tab and Team → Pay's "Team payouts":
  // its heading says the name of the tab it was opened from.
  const underMoney = useRouterState({ select: (st) => st.location.pathname.startsWith('/money/') })
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
        title={underMoney ? 'Crew payouts' : 'Team payouts'}
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
                  setForm({ ...form, amount: parseAmount(e.target.value) })
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

export function TeamPayoutsPage() {
  return (
    <AuthedPage module="team_payouts">
      <TeamPayoutsContent />
    </AuthedPage>
  )
}
