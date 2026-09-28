import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, X, type LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { Input } from './input'

export interface FilterOption {
  value: string
  label: string
  /** Drawn as a dot before the label — a stage colour, a tag colour. */
  color?: string | undefined
  /** How many rows carry it, shown right-aligned. */
  count?: number | undefined
}

/**
 * Pick several of something, from a list that may be long.
 *
 * A native multiple-select is unusable past about six options and cannot show a
 * count or a colour, so every filter we had was single-choice — which is why
 * "these three stages" or "either of these two tags" could not be asked. This is
 * the control the reference app leans on hardest (its CRM toolbar has four of
 * them), and the parts that make it work are the search box, the select-all
 * line, and the count beside each option so you can see what narrowing will cost
 * before you click.
 *
 * Closes on outside click and on Escape: it sits over the list people are
 * reading, and a menu that traps you is worse than no menu.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  icon: Icon,
  placeholder,
  width = 280,
  searchable = true,
  className,
}: {
  /** Plural and lower-cased in the button text: "All stages", "2 stages selected". */
  label: string
  options: readonly FilterOption[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  icon?: LucideIcon
  placeholder?: string
  width?: number
  searchable?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  const chosen = useMemo(() => new Set(selected), [selected])
  const needle = q.trim().toLowerCase()
  const shown = useMemo(
    () => (needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options),
    [options, needle],
  )

  const text =
    selected.length === 0
      ? (placeholder ?? `All ${label.toLowerCase()}`)
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0]!)
        : `${selected.length} ${label.toLowerCase()} selected`

  const toggle = (v: string) =>
    onChange(chosen.has(v) ? selected.filter((x) => x !== v) : [...selected, v])

  return (
    <div ref={box} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={`Filter by ${label.toLowerCase()}`}
        className={cn(
          'flex h-9 min-w-36 items-center justify-between gap-1.5 rounded-md border bg-card px-2.5 text-xs transition-colors hover:bg-accent',
          selected.length > 0 ? 'border-primary/50 font-medium' : 'border-border',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {Icon && <Icon className="size-3.5 shrink-0" />}
          <span className="truncate">{text}</span>
          {selected.length > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] font-medium text-primary-foreground">
              {selected.length}
            </span>
          )}
        </span>
        <span className="text-[0.6rem] text-muted-foreground" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{ width }}
          className="absolute right-0 top-full z-30 mt-1.5 overflow-hidden rounded-md border border-border bg-card shadow-lg"
        >
          {searchable && (
            <div className="flex items-center gap-1.5 border-b border-border p-2">
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                aria-label={`Search ${label.toLowerCase()}`}
                className="h-7 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
              />
              {q && (
                <button type="button" onClick={() => setQ('')} aria-label="Clear search">
                  <X className="size-3 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-b border-border px-2 py-1.5 text-[0.65rem]">
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => onChange([...new Set([...selected, ...shown.map((o) => o.value)])])}
            >
              Select {needle ? 'these' : 'all'}
            </button>
            {selected.length > 0 ? (
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>
                Clear ({selected.length})
              </button>
            ) : (
              <span className="text-muted-foreground">
                {shown.length} option{shown.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {shown.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No matches</p>
            )}
            {shown.map((o) => {
              const on = chosen.has(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(o.value)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent',
                    on && 'bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
                      on ? 'border-primary bg-primary' : 'border-border bg-card',
                    )}
                  >
                    {on && <Check className="size-2.5 text-primary-foreground" />}
                  </span>
                  {o.color && (
                    <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} aria-hidden />
                  )}
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.count !== undefined && (
                    <span className="shrink-0 text-[0.65rem] tabular-nums text-muted-foreground">{o.count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
