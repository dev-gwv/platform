import { useEffect, useRef, useState } from 'react'
import { Check, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import type { ShootPreset } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Input } from '@/shared/ui/input'
import { useDeleteShootPreset } from '@/features/shoots/api'
import { matchShootTypes, type ShootDraft } from '@/features/projects/wizard'
import { useDismiss } from './wizard-ui'

/**
 * The full list of shoot types, searchable, behind the Add shoot button.
 *
 * Seventeen types is too many for chips and too few for the command palette,
 * so it is a menu that opens with the search box focused: type three letters
 * and press Enter, or scroll and click. Anything not on the list is typed in
 * the box and added by name, which is how a studio's odd one-off gets in
 * without anyone maintaining a list of every ceremony in the country.
 */
export function AddShootMenu({
  shoots,
  onAdd,
  extraNames = [],
  variant = 'default',
  label = 'Add another function',
}: {
  shoots: ShootDraft[]
  onAdd: (name: string) => void
  /** This studio's own saved shoot names, merged into the common list. */
  extraNames?: readonly string[]
  variant?: 'default' | 'ghost'
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) search.current?.focus()
    else setQuery('')
  }, [open])

  useDismiss(root, open, () => setOpen(false))

  const taken = new Set(shoots.map((s) => s.name.trim().toLowerCase()))
  const matches = matchShootTypes(query, extraNames)
  const custom = query.trim()
  const free = matches.filter((m) => !taken.has(m.toLowerCase()))

  const choose = (name: string) => {
    onAdd(name)
    setOpen(false)
  }

  /** Arrow keys walk from the box into the list and back, as a menu should. */
  function step(from: HTMLElement | null, dir: 1 | -1) {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    if (items.length === 0) return
    const at = from ? items.indexOf(from) : -1
    const next = at === -1 ? (dir === 1 ? 0 : items.length - 1) : at + dir
    if (next < 0) search.current?.focus()
    else items[Math.min(next, items.length - 1)]?.focus()
  }

  return (
    <div ref={root} className="relative">
      <Button size="sm" variant={variant} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <Plus /> {label}
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Shoot types"
          className="ipc-menu ipc-menu-left absolute left-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            step(document.activeElement as HTMLElement, e.key === 'ArrowDown' ? 1 : -1)
          }}
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter takes the obvious one: the first type still free, or
                  // the words just typed if the list has nothing to offer.
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const pick = free[0] ?? (custom || null)
                  if (pick) choose(pick)
                }}
                placeholder="Search shoot type…"
                aria-label="Search shoot type"
                className="pl-8"
              />
            </div>
          </div>

          <div ref={list} className="max-h-64 overflow-y-auto p-1.5">
            <p className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Common
            </p>
            {matches.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No type matches “{custom}”. Add it below.
              </p>
            ) : (
              matches.map((name) => {
                const already = taken.has(name.toLowerCase())
                return (
                  <button
                    key={name}
                    type="button"
                    role="menuitem"
                    disabled={already}
                    onClick={() => choose(name)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      already
                        ? 'cursor-not-allowed text-muted-foreground opacity-60'
                        : 'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                    )}
                  >
                    <span className="flex-1">{name}</span>
                    {already && <Check className="size-4 shrink-0" aria-hidden />}
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-border p-2">
            <Button
              size="sm"
              className="w-full"
              onClick={() => choose(custom)}
              disabled={!!custom && taken.has(custom.toLowerCase())}
            >
              <Plus /> {custom ? `Add “${custom}”` : 'Add new shoot type'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Saved shapes, listed. The built-in wedding preset rides in the same menu as
 * the studio's own, because from the pressing end they are the same thing.
 */
export function PresetMenu({
  label,
  presets,
  onApply,
  builtIn,
  variant = 'outline',
}: {
  label: string
  presets: ShootPreset[]
  onApply: (preset: ShootPreset) => void
  builtIn?: { label: string; disabled: boolean; onApply: () => void }
  variant?: 'outline' | 'ghost'
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const remove = useDeleteShootPreset()
  useDismiss(root, open, () => setOpen(false))

  return (
    <div ref={root} className="relative">
      <Button size="sm" variant={variant} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Sparkles /> {label}
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="ipc-menu absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-border bg-card p-1.5 shadow-lg"
        >
          {builtIn && (
            <button
              type="button"
              role="menuitem"
              disabled={builtIn.disabled}
              onClick={() => {
                builtIn.onApply()
                setOpen(false)
              }}
              className={cn(
                'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                builtIn.disabled
                  ? 'cursor-not-allowed text-muted-foreground opacity-60'
                  : 'hover:bg-muted',
              )}
            >
              {builtIn.label}
            </button>
          )}
          {presets.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No saved presets yet. Set a shoot up the way you like it, then save it.
            </p>
          ) : (
            presets.map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onApply(p)
                    setOpen(false)
                  }}
                  className="flex-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  {p.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => remove.mutate(p.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 />
                  <span className="sr-only">Delete preset {p.name}</span>
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
