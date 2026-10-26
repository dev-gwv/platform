import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { CrmLead, SavedView, SavedViewQuery } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Input } from '@/shared/ui/input'
import { useConfirm } from '@/shared/ui/confirm'
import { BUILTIN_VIEWS, viewCounts, type BuiltinViewKey } from './builtin-views'
import { useDeleteView, useUpdateView } from './api'

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
  manage,
}: {
  /** Open leads, unfiltered — the counts describe the whole desk. */
  leads: readonly CrmLead[]
  now: Date
  value: ViewChoice
  onChange: (v: ViewChoice) => void
  saved: readonly SavedView[]
  /** What the button reads, worked out by the page that owns the rows. */
  label: string
  /**
   * Renaming, updating and deleting a saved view where it is picked (0286).
   * Only a view's maker or the owner can change it; RLS says the same.
   */
  manage?: { me: string | null; isOwner: boolean; current: SavedViewQuery } | undefined
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
                  <SavedViewRow
                    key={v.id}
                    view={v}
                    on={value.kind === 'saved' && value.id === v.id}
                    onPick={() => pick({ kind: 'saved', id: v.id })}
                    manage={manage && (manage.isOwner || v.user_id === manage.me) ? manage.current : null}
                    onDeleted={() => {
                      if (value.kind === 'saved' && value.id === v.id) onChange({ kind: 'builtin', key: 'all' })
                    }}
                  />
                ))}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

/** One saved view in the picker: pick it, or change it right there. */
function SavedViewRow({
  view: v,
  on,
  onPick,
  manage,
  onDeleted,
}: {
  view: SavedView
  on: boolean
  onPick: () => void
  /** The filters on screen now, when this person may change the view. */
  manage: SavedViewQuery | null
  onDeleted: () => void
}) {
  const update = useUpdateView()
  const del = useDeleteView()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(v.name)

  async function remove() {
    const yes = await confirm({ title: `Delete the view “${v.name}”?`, description: 'The leads stay; only this saved list goes.', confirmLabel: 'Delete', destructive: true })
    if (yes) del.mutate(v.id, { onSuccess: onDeleted })
  }

  return (
    <li>
      <div className="flex items-center gap-1 pr-2">
        <button type="button" role="menuitem" onClick={onPick} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-accent">
          <Check className={cn('size-3.5 shrink-0', on ? 'opacity-100' : 'opacity-0')} />
          <span className="min-w-0 flex-1 truncate text-sm">{v.name}</span>
        </button>
        {manage && (
          <button
            type="button"
            onClick={() => setOpen((x) => !x)}
            aria-expanded={open}
            title={`Change “${v.name}”`}
            aria-label={`Change ${v.name}`}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
          >
            <Pencil className="size-3" />
          </button>
        )}
      </div>
      {manage && open && (
        <div className="flex flex-col gap-1.5 border-y border-border bg-muted/40 px-3 py-2">
          {naming ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (!name.trim() || name.trim() === v.name) return setNaming(false)
                update.mutate({ id: v.id, patch: { name: name.trim() } }, { onSuccess: () => setNaming(false) })
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="View name" className="h-8" autoFocus />
              <Button size="sm" type="submit" disabled={!name.trim() || update.isPending}>
                Save
              </Button>
            </form>
          ) : (
            <Button size="sm" variant="outline" className="justify-start" onClick={() => setNaming(true)}>
              <Pencil /> Rename
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="justify-start"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: v.id, patch: { query: manage } }, { onSuccess: () => setOpen(false) })}
          >
            <SlidersHorizontal /> Save the filters on screen into it
          </Button>
          <Button size="sm" variant="ghost" className="justify-start hover:text-destructive" disabled={del.isPending} onClick={() => void remove()}>
            <Trash2 /> Delete view
          </Button>
        </div>
      )}
    </li>
  )
}
