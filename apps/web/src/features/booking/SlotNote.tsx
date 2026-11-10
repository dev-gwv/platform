import { useState, type FormEvent } from 'react'
import { StickyNote } from 'lucide-react'
import type { TeamSlot } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Label, Textarea } from '@/shared/ui/input'
import { HoverPopover } from '@/shared/ui/hover-popover'
import { cn } from '@/shared/ui/cn'
import { useConfirm } from '@/shared/ui/confirm'
import { useSetSlotNote, ApiError } from '@/features/allocation/api'

/**
 * A note on a booked person, the way the studio used a comment on a cell in
 * its Google Sheet (owner, 10 Nov): a small amber triangle in the corner of
 * the person's chip, and the note -- who wrote it and when -- on hover or tap.
 */

type Noted = Pick<TeamSlot, 'note' | 'note_by_name' | 'note_at'>

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

/** "Asha · 12 Nov, 4:30 pm", or "" when nothing is known. */
export function noteByLine(s: Noted): string {
  const at = s.note_at ? WHEN.format(new Date(s.note_at)).replace(/\b(am|pm)\b/i, (m) => m.toLowerCase()) : null
  return [s.note_by_name, at].filter(Boolean).join(' · ')
}

/** How many of these bookings carry a note: for a title such as the calendar's. */
export const notesCount = (slots: readonly Noted[]) => slots.filter((s) => !!s.note?.trim()).length

function NoteCard({ slot }: { slot: Noted }) {
  const by = noteByLine(slot)
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
        <StickyNote className="size-3.5" aria-hidden /> Note
      </p>
      <p className="whitespace-pre-wrap break-words text-sm">{slot.note}</p>
      {by && <p className="text-xs text-muted-foreground">{by}</p>}
    </div>
  )
}

/**
 * The amber corner. Put it inside the person's chip, which must be
 * `relative`; it draws nothing when there is no note.
 */
export function SlotNoteCorner({ slot, name, className }: { slot: Noted; name?: string | null; className?: string }) {
  if (!slot.note?.trim()) return null
  return (
    <HoverPopover content={<NoteCard slot={slot} />} align="end">
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Note on ${name ?? 'this booking'}: ${slot.note}`}
        className={cn('absolute right-0 top-0 z-[1] size-4 rounded-tr-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      >
        <span
          aria-hidden
          className="absolute right-0 top-0 size-2.5 bg-tone-amber"
          style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }}
        />
      </button>
    </HoverPopover>
  )
}

/** The note written out in a line, where a hover card does not fit (inside a dialog, My shoots). */
export function SlotNoteLine({ slot, className }: { slot: Noted; className?: string }) {
  if (!slot.note?.trim()) return null
  const by = noteByLine(slot)
  return (
    <span className={cn('flex items-start gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-[11px] text-foreground', className)}>
      <StickyNote className="mt-px size-3 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 whitespace-pre-wrap break-words">
        {slot.note}
        {by && <span className="text-muted-foreground"> · {by}</span>}
      </span>
    </span>
  )
}

/** Add, change or take off a booking's note. */
export function SlotNoteDialog({ slot, onClose }: { slot: TeamSlot; onClose: () => void }) {
  const save = useSetSlotNote()
  const confirm = useConfirm()
  const [text, setText] = useState(slot.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const had = !!slot.note?.trim()

  async function put(note: string | null) {
    setError(null)
    try {
      await save.mutateAsync({ id: slot.id, note })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save the note.')
    }
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void put(text.trim() || null)
  }
  async function remove() {
    const yes = await confirm({ title: 'Take the note off?', confirmLabel: 'Take it off', destructive: true })
    if (yes) void put(null)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Note on ${slot.user_name ?? 'this booking'}`}
        description={[slot.shoot_name, slot.service_name].filter(Boolean).join(' · ') || undefined}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slot-note">Note</Label>
            <Textarea
              id="slot-note"
              rows={3}
              maxLength={500}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Bring the 70-200 · Leaves at 9 pm for another event"
              className={cn(text.trim() ? 'border-success/50' : 'border-warning/60 bg-warning/5')}
            />
            <p className="text-xs text-muted-foreground">Everyone who sees this booking can read it, {slot.user_name ?? 'the person'} too.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {had && (
              <Button type="button" variant="ghost" className="mr-auto hover:text-destructive" disabled={save.isPending} onClick={() => void remove()}>
                Take the note off
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || (!text.trim() && !had)}>
              {save.isPending ? 'Saving…' : 'Save note'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The note edited in place, for inside a dialog (Assign team), where a second
 * dialog or a floating card would sit awkwardly.
 */
export function InlineSlotNoteEditor({ slot, onClose, className }: { slot: TeamSlot; onClose: () => void; className?: string }) {
  const save = useSetSlotNote()
  const [text, setText] = useState(slot.note ?? '')
  const had = !!slot.note?.trim()
  const put = (note: string | null) => save.mutate({ id: slot.id, note }, { onSuccess: onClose })
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-md border border-border bg-card p-2', className)}>
      <Textarea
        rows={2}
        maxLength={500}
        autoFocus
        aria-label={`Note on ${slot.user_name ?? 'this booking'}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Bring the 70-200 · Leaves at 9 pm for another event"
        className={cn('text-sm', text.trim() ? 'border-success/50' : 'border-warning/60 bg-warning/5')}
      />
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {had && (
          <Button type="button" size="sm" variant="ghost" className="mr-auto h-7 px-2.5 text-xs hover:text-destructive" disabled={save.isPending} onClick={() => put(null)}>
            Take it off
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" className="h-7 px-2.5 text-xs" disabled={save.isPending || (!text.trim() && !had)} onClick={() => put(text.trim() || null)}>
          Save note
        </Button>
      </div>
    </div>
  )
}
