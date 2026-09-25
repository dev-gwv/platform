import { useState, type FormEvent } from 'react'
import type { TeamSlot } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useMembers, useSetSlotCost, useUpdateSlot, ApiError } from '@/features/allocation/api'

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** What a booking pays out: estimated, final once agreed, and how sure it is. */
export function SlotCostDialog({ slot, onClose }: { slot: TeamSlot; onClose: () => void }) {
  const setCost = useSetSlotCost()
  const initial = {
    estimated: String(slot.estimated_cost ?? ''),
    final: String(slot.final_cost ?? ''),
    status: slot.cost_status,
    notes: slot.cost_notes ?? '',
  }
  const [estimated, setEstimated] = useState(initial.estimated)
  const [final, setFinal] = useState(initial.final)
  const [status, setStatus] = useState(initial.status)
  const [notes, setNotes] = useState(initial.notes)
  const [error, setError] = useState<string | null>(null)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    `team-slot-cost:${slot.id}`,
    { estimated, final, status, notes },
    (v) => {
      setEstimated(v.estimated)
      setFinal(v.final)
      setStatus(v.status)
      setNotes(v.notes)
    },
    { isBlank: (v) => JSON.stringify(v) === JSON.stringify(initial) },
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (status === 'final' && !final.trim() && !estimated.trim()) {
      setError('A final payout needs an amount.')
      return
    }
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
      draft.clear()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save the payout.')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Payout — ${slot.user_name ?? 'this booking'}`} description={[slot.shoot_name, slot.service_name].filter(Boolean).join(' · ') || undefined}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slot-est">Estimated (₹)</Label>
              <Input id="slot-est" type="number" min={0} value={estimated} onChange={(e) => setEstimated(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slot-final">Final (₹)</Label>
              <Input id="slot-final" type="number" min={0} value={final} onChange={(e) => setFinal(e.target.value)} placeholder="Once agreed" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slot-cost-status">Status</Label>
            <Select id="slot-cost-status" value={status} onChange={(e) => setStatus(e.target.value as TeamSlot['cost_status'])}>
              <option value="not_decided">Not decided</option>
              <option value="tentative">Tentative</option>
              <option value="final">Final</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slot-cost-notes">Notes</Label>
            <Input id="slot-cost-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How this figure was agreed" />
          </div>
          <p className="text-xs text-muted-foreground">Team members never see payouts.</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={setCost.isPending}>
              {setCost.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Who, which role and when: everything about a booking but its payout. */
export function SlotEditDialog({ slot, onClose, focus = 'hours' }: { slot: TeamSlot; onClose: () => void; focus?: 'person' | 'hours' }) {
  const members = useMembers()
  const update = useUpdateSlot()
  const [userId, setUserId] = useState(slot.user_id)
  const [service, setService] = useState(slot.service_name ?? '')
  const [start, setStart] = useState(toLocalInput(slot.start_at))
  const [end, setEnd] = useState(toLocalInput(slot.end_at))
  const [error, setError] = useState<string | null>(null)
  const draft = useFormDraft(`team-slot:${slot.id}`, { userId, service, start, end }, (v) => {
    setUserId(v.userId)
    setService(v.service)
    setStart(v.start)
    setEnd(v.end)
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const startIso = new Date(start).toISOString()
    const endIso = new Date(end).toISOString()
    if (!(new Date(endIso) > new Date(startIso))) {
      setError('End must be after start.')
      return
    }
    try {
      await update.mutateAsync({
        id: slot.id,
        patch: { user_id: userId, service_name: service.trim() || null, start_at: startIso, end_at: endIso },
      })
      draft.clear()
      onClose()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'That person is already booked at this time. Pick someone else or other hours.'
          : err instanceof ApiError
            ? err.message
            : 'We could not save these changes.',
      )
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={focus === 'person' ? 'Change who is booked' : 'Edit booking'}
        description={[slot.shoot_name, slot.service_name].filter(Boolean).join(' · ') || undefined}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slot-member">Person</Label>
            <Select id="slot-member" value={userId} onChange={(e) => setUserId(e.target.value)} required autoFocus={focus === 'person'}>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slot-role">Role</Label>
            <Input id="slot-role" value={service} onChange={(e) => setService(e.target.value)} placeholder="Candid Photographer" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slot-start">Start</Label>
              <Input id="slot-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slot-end">End</Label>
              <Input id="slot-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
