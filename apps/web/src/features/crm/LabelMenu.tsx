import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Loader2, Minus, Plus, Search } from 'lucide-react'
import type { TagColor } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { TONE_BG } from '@/shared/ui/tones'
import { useCreateTag, useTags } from './api'
import { TagChip } from './TagChip'

const COLORS: readonly TagColor[] = ['blue', 'green', 'violet', 'amber', 'rose', 'teal']

/**
 * The studio's labels as a multi-pick list, with "+ Add new label" -- the one
 * picker the drawer, the bulk bar and Add lead all use.
 *
 * A lead carries as many labels as it needs (VIP, Destination, Referral…);
 * that is the owner's "select multiple labels". `partial` is for the bulk bar:
 * a label only some of the picked leads carry shows a dash, and a tap puts it
 * on all of them.
 */
export function LabelMenu({
  selected,
  partial,
  onToggle,
  canCreate,
  trigger,
  align = 'start',
}: {
  selected: ReadonlySet<string>
  partial?: ReadonlySet<string> | undefined
  onToggle: (tag: { id: string; name: string }, on: boolean) => void
  canCreate: boolean
  trigger: ReactNode
  align?: 'start' | 'end' | undefined
}) {
  const all = useTags()
  const create = useCreateTag()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [color, setColor] = useState<TagColor>('violet')
  const input = useRef<HTMLInputElement>(null)

  const needle = q.trim().toLowerCase()
  const options = useMemo(
    () =>
      (all.data ?? [])
        // A retired label is not offered again unless something picked still carries it.
        .filter((t) => t.is_active || selected.has(t.id) || partial?.has(t.id))
        .filter((t) => !needle || t.name.toLowerCase().includes(needle)),
    [all.data, needle, selected, partial],
  )
  const exact = (all.data ?? []).find((t) => t.name.trim().toLowerCase() === needle)
  const canAdd = canCreate && needle.length > 0 && !exact

  async function add() {
    const name = q.trim()
    if (!name) return
    const made = await create.mutateAsync({ name, color })
    onToggle({ id: made.id, name: made.name }, true)
    setQ('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-72 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          input.current?.focus()
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (exact) onToggle(exact, !selected.has(exact.id))
              else if (canAdd) void add()
            }}
            placeholder={canCreate ? 'Search or add a label…' : 'Search labels…'}
            aria-label="Search labels"
            className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ul className="max-h-64 overflow-y-auto py-1">
          {options.map((t) => {
            const on = selected.has(t.id)
            const some = !on && !!partial?.has(t.id)
            return (
              <li key={t.id}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on ? true : some ? 'mixed' : false}
                  onClick={() => onToggle(t, !on)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded border',
                      on || some ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card',
                    )}
                    aria-hidden
                  >
                    {on ? <Check className="size-3" /> : some ? <Minus className="size-3" /> : null}
                  </span>
                  <TagChip tag={t} />
                  {t.lead_count > 0 && (
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">{t.lead_count}</span>
                  )}
                </button>
              </li>
            )
          })}
          {options.length === 0 && !canAdd && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {needle ? 'Nothing matches.' : canCreate ? 'No labels yet — type one above.' : 'No labels yet.'}
            </li>
          )}
        </ul>

        {canCreate && (
          <div className="border-t border-border p-2">
            {canAdd ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 px-1" role="radiogroup" aria-label="Colour">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={color === c}
                      aria-label={c}
                      onClick={() => setColor(c)}
                      className={cn(
                        'size-5 rounded-full ring-offset-2 ring-offset-card transition',
                        TONE_BG[c],
                        color === c ? 'ring-2 ring-foreground' : 'hover:scale-110',
                      )}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={create.isPending}
                  className="flex w-full items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 text-left text-sm font-medium text-primary hover:bg-primary/15"
                >
                  {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  <span className="truncate">Add “{q.trim()}”</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => input.current?.focus()}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary hover:bg-primary/10"
              >
                <Plus className="size-3.5" /> Add new label
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
