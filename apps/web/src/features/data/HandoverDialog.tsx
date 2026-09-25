import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { DataRecord, TeamSlot } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { useMembers } from '@/features/allocation/api'
import { useHandover } from './api'

const SOMEONE_ELSE = '__else'

/**
 * Crew: "my cards are with the studio now". How many cards, roughly how big,
 * who took them, and anything the editor should know. The studio does the
 * copying and the backup; this is the handover only.
 */
export function HandoverDialog({
  slot,
  shootName,
  record,
  onClose,
}: {
  slot: Pick<TeamSlot, 'id' | 'service_name'>
  shootName: string
  record?: DataRecord | undefined
  onClose: () => void
}) {
  const members = useMembers()
  const handover = useHandover()
  const [cards, setCards] = useState(record?.card_count ? String(record.card_count) : '1')
  const [size, setSize] = useState(record?.size_gb ? String(record.size_gb) : '')
  const [to, setTo] = useState(record?.received_by_uid ?? (record?.received_by_name ? SOMEONE_ELSE : ''))
  const [toName, setToName] = useState(record && !record.received_by_uid ? (record.received_by_name ?? '') : '')
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  function save() {
    const c = Math.round(Number(cards))
    const g = size.trim() ? Number(size) : 0
    if (!Number.isFinite(c) || c < 0 || !Number.isFinite(g) || g < 0) {
      setError('Cards and size must be numbers.')
      return
    }
    handover.mutate(
      {
        slotId: slot.id,
        card_count: c,
        size_gb: g,
        handed_to_uid: to && to !== SOMEONE_ELSE ? to : null,
        handed_to_name: to === SOMEONE_ELSE ? toName.trim() || null : null,
        notes: notes.trim() || null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Hand over data" description={`${shootName} · ${slot.service_name ?? 'Crew'}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ho-cards">Cards / drives</Label>
            <Input id="ho-cards" type="number" min={0} inputMode="numeric" value={cards} onChange={(e) => setCards(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ho-size">Size (GB, roughly)</Label>
            <Input id="ho-size" type="number" min={0} inputMode="decimal" placeholder="e.g. 256" value={size} onChange={(e) => setSize(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ho-to">Given to</Label>
            <Select id="ho-to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Left at the studio</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
              <option value={SOMEONE_ELSE}>Someone else…</option>
            </Select>
            {to === SOMEONE_ELSE && (
              <Input aria-label="Their name" placeholder="Their name" value={toName} onChange={(e) => setToName(e.target.value)} autoFocus />
            )}
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ho-notes">Anything to know</Label>
            <Textarea
              id="ho-notes"
              rows={2}
              placeholder="A slow card, a missing clip, two cameras on one card…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={handover.isPending}>
            {handover.isPending && <Loader2 className="animate-spin" />} Hand over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
