import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, MapPinCheck, X } from 'lucide-react'
import { z, type TeamSlot } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { readPosition } from '@/features/attendance/auto'

const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' })

function useSlotAction<T>(path: (id: string) => string, done: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: T }) => callApi(path(id), { method: 'POST', body, responseSchema: z.any() }),
    onSuccess: () => {
      toast.success(done)
      void qc.invalidateQueries({ queryKey: ['allocation'] })
      void qc.invalidateQueries({ queryKey: ['shoots'] })
      // "I've reached" is a shoot day's attendance: the Home card follows at once.
      void qc.invalidateQueries({ queryKey: ['hr', 'attendance', 'me'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Is the "I've reached" window open: three hours before the start until the end. */
export const canArrive = (s: Pick<TeamSlot, 'start_at' | 'end_at'>, now = Date.now()) =>
  now >= new Date(s.start_at).getTime() - 3 * 3600_000 && now <= new Date(s.end_at).getTime()

/**
 * The person booked answers their booking (0207): Confirm, or Can't make it
 * with a reason; on the day, I've reached. What the booking needs next is
 * the only thing shown.
 */
export function SlotAnswer({ slot }: { slot: TeamSlot }) {
  const respond = useSlotAction<{ response: 'confirmed' | 'declined'; reason?: string }>((id) => `/allocation/${id}/respond`, 'Thanks — your answer is saved')
  const arrived = useSlotAction<{ lat?: number; lng?: number }>((id) => `/allocation/${id}/arrived`, 'Marked as reached')
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  if (slot.status !== 'booked' || new Date(slot.end_at).getTime() < Date.now()) return null

  if (slot.arrived_at) return <StatusBadge tone="success">Reached {time.format(new Date(slot.arrived_at))}</StatusBadge>

  if (canArrive(slot) && slot.response !== 'declined') {
    return (
      <Button
        size="sm"
        className="h-7"
        disabled={arrived.isPending}
        onClick={() =>
          void readPosition(true).then(
            (p) => arrived.mutate({ id: slot.id, body: { lat: p.coords.latitude, lng: p.coords.longitude } }),
            () => arrived.mutate({ id: slot.id, body: {} }),
          )
        }
      >
        <MapPinCheck /> I've reached
      </Button>
    )
  }

  if (slot.response === 'declined') return <StatusBadge tone="danger">You declined</StatusBadge>
  if (slot.response === 'confirmed') return <StatusBadge tone="success">Confirmed</StatusBadge>

  if (declining) {
    return (
      <span className="flex w-full flex-wrap items-center gap-2">
        <Input
          autoFocus
          className={`h-8 min-w-0 flex-1 ${reason.trim().length >= 3 ? 'border-success/50 bg-success/10' : 'border-warning/60 bg-warning/10'}`}
          placeholder="Why can't you make it?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          size="sm"
          variant="destructive"
          className="h-8"
          disabled={reason.trim().length < 3 || respond.isPending}
          onClick={() => respond.mutate({ id: slot.id, body: { response: 'declined', reason: reason.trim() } }, { onSuccess: () => setDeclining(false) })}
        >
          Send
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setDeclining(false)}>
          Cancel
        </Button>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2">
      <Button size="sm" className="h-7" disabled={respond.isPending} onClick={() => respond.mutate({ id: slot.id, body: { response: 'confirmed' } })}>
        <Check /> Confirm
      </Button>
      <Button size="sm" variant="outline" className="h-7 hover:border-destructive hover:text-destructive" onClick={() => setDeclining(true)}>
        <X /> Can't make it
      </Button>
    </span>
  )
}

/** The crew member's answer as a chip, for the people who booked them. */
export function ResponseChip({ slot }: { slot: Pick<TeamSlot, 'response' | 'decline_reason' | 'arrived_at' | 'status'> }) {
  if (slot.status !== 'booked') return null
  if (slot.arrived_at) return <StatusBadge tone="success">Reached</StatusBadge>
  if (slot.response === 'confirmed') return <StatusBadge tone="success">✓ Confirmed</StatusBadge>
  if (slot.response === 'declined')
    return (
      <StatusBadge tone="danger" title={slot.decline_reason ?? undefined}>
        ✗ Can't make it
      </StatusBadge>
    )
  return <StatusBadge tone="warning">? No answer</StatusBadge>
}
