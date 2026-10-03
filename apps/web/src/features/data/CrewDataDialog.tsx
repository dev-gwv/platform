import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dataRecord, type ShootListItem, type TeamSlot } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useStorageLocations } from './api'
import { defaultLabel } from './stage'
import { useINR } from '@/shared/money/MoneyMask'
import { useCanPay, usePaySlot, useProjectPayouts } from '@/features/team-payouts/pay'

/**
 * The day after a wedding, everyone's cards come in at once. One line per
 * person -- how many cards, how many GB -- and one disk for all of them, in
 * place of opening the same dialog six times. A line left at 0 cards is
 * skipped, so someone who has not handed over yet stays on the list.
 */
export function CrewDataDialog({
  projectId,
  shoot,
  slots,
  onClose,
}: {
  projectId: string
  shoot: Pick<ShootListItem, 'id' | 'name'>
  /** The people still owing a record. */
  slots: readonly TeamSlot[]
  onClose: () => void
}) {
  const inr = useINR()
  const { session } = useAuth()
  const qc = useQueryClient()
  const locations = useStorageLocations()
  const [received, setReceived] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [disk, setDisk] = useState('')
  const [rows, setRows] = useState(() =>
    Object.fromEntries(slots.map((s) => [s.id, { cards: '', gb: '' }])),
  )
  const [busy, setBusy] = useState(false)
  // Pay each person as their cards come in: a tick pays what is still owed.
  const canPay = useCanPay()
  const payouts = useProjectPayouts(projectId)
  const paySlot = usePaySlot()
  const [pay, setPay] = useState<Record<string, boolean>>({})
  const owed = (id: string) => {
    const p = payouts.data?.find((x) => x.slot_id === id)
    return p ? Math.max(0, Math.round((p.amount - p.paid) * 100) / 100) : 0
  }
  const toPay = canPay ? slots.filter((s) => pay[s.id] && owed(s.id) > 0) : []

  const filled = slots.filter((s) => Number(rows[s.id]?.cards) > 0)
  const set = (id: string, k: 'cards' | 'gb', v: string) =>
    setRows((r) => ({ ...r, [id]: { ...r[id]!, [k]: v } }))

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (filled.length === 0 && toPay.length === 0) return
    setBusy(true)
    let saved = 0
    for (const s of filled) {
      const r = rows[s.id]!
      try {
        await callApi('/data', {
          method: 'POST',
          responseSchema: dataRecord,
          body: {
            project_id: projectId,
            shoot_id: shoot.id,
            slot_id: s.id,
            user_id: s.user_id,
            data_label: defaultLabel(shoot, s),
            card_count: Math.max(0, Math.round(Number(r.cards) || 0)),
            size_gb: Math.max(0, Number(r.gb) || 0),
            date_received: received || undefined,
            copied_by_uid: session?.user_id ?? null,
            primary_location_id: disk || null,
            primary_status: disk ? 'copied' : 'pending',
            team_member_name: s.user_name ?? undefined,
            requirement_name: s.service_name ?? undefined,
          },
        })
        saved++
      } catch (err) {
        toast.error(`${s.user_name ?? 'One person'}: ${(err as Error).message}`)
      }
    }
    let paid = 0
    for (const s of toPay) {
      try {
        await paySlot.mutateAsync({
          slotId: s.id,
          body: { paid_now: owed(s.id), paid_date: new Date().toLocaleDateString('en-CA') },
        })
        paid++
      } catch {
        // usePaySlot toasts the reason.
      }
    }
    setBusy(false)
    void qc.invalidateQueries({ queryKey: ['data'] })
    if (saved) toast.success(`Cards recorded for ${saved} ${saved === 1 ? 'person' : 'people'}`)
    if (paid) toast.success(`Paid ${paid} ${paid === 1 ? 'person' : 'people'}`)
    if (saved === filled.length && paid === toPay.length) onClose()
  }

  const active = (locations.data ?? []).filter((l) => l.is_active)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Everyone's cards · ${shoot.name}`} className="max-w-xl">
        <form onSubmit={(e) => void onSave(e)} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="crew-received">Received on</Label>
              <Input
                id="crew-received"
                type="date"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="crew-disk">Copied to</Label>
              <Select
                id="crew-disk"
                value={disk}
                onChange={(e) => setDisk(e.target.value)}
                className={cn(!disk && 'border-warning/60')}
              >
                <option value="">Not copied yet</option>
                {active.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <ul className="flex flex-col gap-1.5">
            {slots.map((s) => {
              const r = rows[s.id]!
              const done = Number(r.cards) > 0
              return (
                <li
                  key={s.id}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2',
                    done ? 'border-success/50 bg-success/15' : 'border-border bg-card',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.user_name ?? 'Someone'}</p>
                    {s.service_name && (
                      <p className="truncate text-xs text-muted-foreground">{s.service_name}</p>
                    )}
                  </div>
                  <Input
                    value={r.cards}
                    onChange={(e) => set(s.id, 'cards', e.target.value)}
                    inputMode="numeric"
                    placeholder="Cards"
                    aria-label={`${s.user_name ?? 'Their'} cards`}
                    className="w-20"
                  />
                  <Input
                    value={r.gb}
                    onChange={(e) => set(s.id, 'gb', e.target.value)}
                    inputMode="decimal"
                    placeholder="GB"
                    aria-label={`${s.user_name ?? 'Their'} GB`}
                    className="w-20"
                  />
                  {canPay && owed(s.id) > 0 && (
                    <button
                      type="button"
                      aria-pressed={!!pay[s.id]}
                      aria-label={`Paid ${s.user_name ?? 'them'} ${inr(owed(s.id))}`}
                      onClick={() => setPay((p) => ({ ...p, [s.id]: !p[s.id] }))}
                      className={cn(
                        'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        pay[s.id]
                          ? 'border-success bg-success text-white'
                          : 'border-dashed border-warning/70 bg-warning/[0.06] text-foreground hover:bg-warning/10',
                      )}
                    >
                      {pay[s.id] ? '✓ Paid ' : 'Pay '}
                      {inr(owed(s.id))}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>

          <p className="text-xs text-muted-foreground">
            {filled.length} of {slots.length} filled
            {toPay.length ? ` · ${toPay.length} to pay` : ''} · anyone left at 0 cards stays on the
            list for later.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={(filled.length === 0 && toPay.length === 0) || busy}>
              {busy
                ? 'Saving…'
                : filled.length
                  ? `Save ${filled.length} ${filled.length === 1 ? 'record' : 'records'}`
                  : toPay.length
                    ? `Pay ${toPay.length}`
                    : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
