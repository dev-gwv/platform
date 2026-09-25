import { useId, useRef, useState, type FormEvent } from 'react'
import { BellPlus, CalendarClock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ReminderEntityType } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/ui/cn'
import { useCreateReminder } from './api'
import {
  fromIstInputValue,
  quickAt,
  quickChoices,
  reminderTitle,
  toIstInputValue,
  whenPhrase,
  type QuickKey,
} from './remind-times'

const choiceClass =
  'flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

/**
 * "Remind me": a small bell on a task, shoot, deliverable or project that
 * sets a reminder for yourself in two taps — when, and optionally why. It
 * goes on the reminders board linked to the thing, and into the bell when it
 * is due, carrying the note and a link straight back here.
 *
 * Times are India time whatever zone the device is in (see remind-times).
 */
export function RemindMe({
  entityType,
  entityId,
  name,
  context,
  align = 'end',
  className,
}: {
  entityType: ReminderEntityType
  entityId: string
  /** What it is: "Photo Album". The reminder reads "Follow up: Photo Album". */
  name: string
  /** Where it belongs, when the name alone could be any wedding — usually the project. */
  context?: string | null | undefined
  align?: 'start' | 'end'
  className?: string | undefined
}) {
  const [open, setOpen] = useState(false)
  // The choices are worked out from when the panel opened, so what is tapped
  // is what was on screen — except "In 1 hour", which counts from the tap.
  const [openedAt, setOpenedAt] = useState(() => new Date())
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState<QuickKey | 'picked' | null>(null)
  const create = useCreateReminder()
  const first = useRef<HTMLButtonElement>(null)
  const noteId = useId()
  const title = reminderTitle(name, context)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    // A fresh start each time: nothing half-typed is carried onto the next thing.
    setOpenedAt(new Date())
    setNote('')
    setPicking(false)
    setPicked('')
  }

  function remind(at: Date, key: QuickKey | 'picked') {
    const now = new Date()
    setBusy(key)
    create.mutate(
      {
        title,
        description: note.trim() || null,
        priority: 'medium',
        entity_type: entityType,
        entity_id: entityId,
        due_at: at.toISOString(),
      },
      {
        onSuccess: () => {
          toast.success(`I’ll remind you ${whenPhrase(at, now)}`)
          setOpen(false)
        },
        onSettled: () => setBusy(null),
      },
    )
  }

  const pickedAt = picked ? fromIstInputValue(picked) : null
  const pickedPast = pickedAt !== null && pickedAt.getTime() <= Date.now()

  function submitPicked(e: FormEvent) {
    e.preventDefault()
    // The panel is portalled, but React still bubbles a submit to any form
    // this button happens to sit inside.
    e.stopPropagation()
    if (pickedAt && !pickedPast) remind(pickedAt, 'picked')
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remind me about ${name}`}
          title="Remind me"
          // Rows and cards that open on a click must not open under this one.
          onClick={(e) => e.stopPropagation()}
          className={cn('size-8 shrink-0 text-muted-foreground hover:text-foreground', className)}
        >
          <BellPlus />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        aria-label={`Remind me about ${name}`}
        // The first time, not the note: focusing a text box would throw up the
        // keyboard on a phone before anything has been chosen.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          first.current?.focus()
        }}
        // Portalled, but React still bubbles clicks to the card behind it.
        onClick={(e) => e.stopPropagation()}
        className="w-[min(18rem,calc(100vw-2rem))] p-2"
      >
        <div className="px-1 pb-2">
          <p className="text-sm font-semibold">Remind me</p>
          <p className="truncate text-xs text-muted-foreground" title={title}>
            {title}
          </p>
        </div>

        <div className="px-1 pb-1.5">
          <label htmlFor={noteId} className="sr-only">
            Note
          </label>
          <Input
            id={noteId}
            value={note}
            maxLength={200}
            placeholder="Add a note (optional)"
            onChange={(e) => setNote(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        <ul className="flex flex-col">
          {quickChoices(openedAt).map((c, i) => (
            <li key={c.key}>
              <button
                ref={i === 0 ? first : undefined}
                type="button"
                disabled={create.isPending}
                onClick={() => remind(c.key === 'hour' ? quickAt('hour', new Date()) : c.at, c.key)}
                className={choiceClass}
              >
                <span className="font-medium">{c.label}</span>
                {busy === c.key ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />
                ) : (
                  c.hint && <span className="shrink-0 text-xs text-muted-foreground">{c.hint}</span>
                )}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              aria-expanded={picking}
              disabled={create.isPending}
              onClick={() => {
                setPicking((v) => !v)
                if (!picked) setPicked(toIstInputValue(quickAt('tomorrow', openedAt)))
              }}
              className={choiceClass}
            >
              <span className="inline-flex items-center gap-2 font-medium">
                <CalendarClock className="size-4 text-muted-foreground" aria-hidden /> Pick date &amp; time
              </span>
            </button>
          </li>
        </ul>

        {picking && (
          <form onSubmit={submitPicked} className="mt-1 flex flex-col gap-1.5 border-t border-border px-1 pt-2">
            <div className="flex items-center gap-1.5">
              <Input
                type="datetime-local"
                aria-label="Date and time, India time"
                value={picked}
                min={toIstInputValue(openedAt)}
                onChange={(e) => setPicked(e.target.value)}
                aria-invalid={pickedPast || undefined}
                className="h-8 min-w-0 flex-1 px-2 text-sm"
              />
              <Button type="submit" size="sm" disabled={!pickedAt || pickedPast || create.isPending}>
                {busy === 'picked' ? <Loader2 className="animate-spin" aria-label="Saving" /> : 'Set'}
              </Button>
            </div>
            <p className={cn('text-xs', pickedPast ? 'text-destructive' : 'text-muted-foreground')}>
              {pickedPast
                ? 'Pick a time in the future.'
                : pickedAt
                  ? `India time · ${whenPhrase(pickedAt, new Date())}`
                  : 'India time'}
            </p>
          </form>
        )}
      </PopoverContent>
    </Popover>
  )
}
