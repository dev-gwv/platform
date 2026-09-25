import { useMemo, useState, type FormEvent } from 'react'
import { CalendarClock } from 'lucide-react'
import { findConflicts } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useBookSlots, useMembers, useSlots } from '@/features/allocation/api'

/**
 * Hold someone's time that is not a shoot on the calendar: leave, a second
 * job, a travel day. It blocks them the same way a booking does, so nobody
 * books them over it.
 */
export function BlockTimeDialog({ onClose }: { onClose: () => void }) {
  const members = useMembers()
  const slots = useSlots()
  const book = useBookSlots()
  const [userIds, setUserIds] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const draft = useFormDraft('team-block-time', { userIds, reason, start, end }, (v) => {
    setUserIds(v.userIds)
    setReason(v.reason)
    setStart(v.start)
    setEnd(v.end)
  }, { isBlank: (v) => v.userIds.length === 0 && !v.reason && !v.start && !v.end })

  const clashes = useMemo(() => {
    if (!start || !end || !userIds.length) return []
    const window = { start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString() }
    return userIds.filter((u) => {
      try {
        return findConflicts(window, (slots.data ?? []).filter((s) => s.user_id === u && s.status === 'booked')).length > 0
      } catch {
        return false
      }
    })
  }, [userIds, start, end, slots.data])
  const nameOf = (id: string) => members.data?.find((m) => m.user_id === id)?.name ?? 'Someone'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!userIds.length) return setError('Pick at least one person.')
    if (!(new Date(end) > new Date(start))) return setError('End must be after start.')
    const res = await book
      .mutateAsync(
        userIds.map((u) => ({
          user_id: u,
          shoot_id: null,
          service_name: reason.trim() || 'Unavailable',
          start_at: new Date(start).toISOString(),
          end_at: new Date(end).toISOString(),
        })),
      )
      .catch((err: Error) => {
        setError(err.message)
        return null
      })
    if (!res) return
    const failed = res.results.filter((r) => r.error)
    if (failed.length) {
      setError(`${failed.map((f) => nameOf(userIds[f.index]!)).join(', ')} already booked at that time.`)
      setUserIds(failed.map((f) => userIds[f.index]!))
      return
    }
    draft.clear()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Block time" description="Mark someone as unavailable outside a shoot, so nobody books them over it.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Who ({userIds.length} picked)</legend>
            <div className="grid max-h-44 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {(members.data ?? []).map((m) => (
                <label key={m.user_id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                  <input
                    type="checkbox"
                    checked={userIds.includes(m.user_id)}
                    onChange={() => setUserIds((p) => (p.includes(m.user_id) ? p.filter((x) => x !== m.user_id) : [...p, m.user_id]))}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="block-reason">Why</Label>
            <Input id="block-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Leave, travel, another job…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="block-start">From</Label>
              <Input id="block-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="block-end">Until</Label>
              <Input id="block-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          {clashes.length > 0 && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              Already booked then: {clashes.map(nameOf).join(', ')}.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={book.isPending || clashes.length > 0}>
              <CalendarClock /> {book.isPending ? 'Saving…' : 'Block time'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
