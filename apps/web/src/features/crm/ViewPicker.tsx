import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { CrmLead, SavedView } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { BUILTIN_VIEWS, viewCounts, type BuiltinViewKey } from './builtin-views'

/**
 * Which leads, not how they are drawn.
 *
 * This used to carry 'pipeline' and 'board' too, so picking the stage board
 * also threw away whatever view you were in -- you could not look at Hot leads
 * on a board. Drawing mode is now its own control beside this one, the way the
 * reference app has always had it.
 */
export type ViewChoice =
  | { kind: 'builtin'; key: BuiltinViewKey }
  | { kind: 'saved'; id: string }

export const sameView = (a: ViewChoice, b: ViewChoice): boolean =>
  a.kind === b.kind &&
  (a.kind === 'builtin' ? a.key === (b as { key: string }).key : true) &&
  (a.kind === 'saved' ? a.id === (b as { id: string }).id : true)

/**
 * The whole control strip of the leads page, in one line.
 *
 * This replaces four tabs, four counter cards and two full-width filter bars.
 * Every number those cards showed is the size of a list, so it now sits beside
 * the name of the list — a figure is never on screen without the rows that
 * explain it, and the page opens with one thing on it.
 */
export function ViewPicker({
  leads,
  now,
  value,
  onChange,
  saved,
  label,
}: {
  /** Open leads, unfiltered — the counts describe the whole desk. */
  leads: readonly CrmLead[]
  now: Date
  value: ViewChoice
  onChange: (v: ViewChoice) => void
  saved: readonly SavedView[]
  /** What the button reads, worked out by the page that owns the rows. */
  label: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const counts = viewCounts(leads, now)

  // Close on an outside click or Escape. A menu that traps you is worse than
  // no menu, and this one sits over the list people are trying to read.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  function pick(v: ViewChoice) {
    onChange(v)
    setOpen(false)
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-base font-semibold tracking-tight transition-colors hover:bg-accent"
      >
        {label}
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <ul className="py-1">
            {BUILTIN_VIEWS.map((v) => {
              const n = counts[v.key]
              const on = value.kind === 'builtin' && value.key === v.key
              return (
                <li key={v.key}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => pick({ kind: 'builtin', key: v.key })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                  >
                    <Check className={cn('size-3.5 shrink-0', on ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{v.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{v.hint}</span>
                    </span>
                    {/* Nothing rather than a zero: an empty list is not news. */}
                    {n > 0 && <span className="text-xs tabular-nums text-muted-foreground">{n}</span>}
                  </button>
                </li>
              )
            })}

            {saved.length > 0 && (
              <>
                <li
                  className="border-t border-border px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  role="presentation"
                >
                  Saved
                </li>
                {saved.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => pick({ kind: 'saved', id: v.id })}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                    >
                      <Check
                        className={cn(
                          'size-3.5 shrink-0',
                          value.kind === 'saved' && value.id === v.id ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{v.name}</span>
                    </button>
                  </li>
                ))}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
