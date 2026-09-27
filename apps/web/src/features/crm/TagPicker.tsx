import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, Tag as TagIcon } from 'lucide-react'
import type { LeadTag } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useCreateTag, useSetLeadTags, useTags } from './api'
import { TagChip } from './TagChip'

/**
 * The tags on one lead, and a way to change them.
 *
 * This replaces a free-text box called "Group / tag" that held one value, had
 * no list behind it, and whose filter was never wired up — so whatever a studio
 * typed there could not be asked for afterwards.
 *
 * The picker sends the whole set rather than a diff, so adding one tag and
 * removing another are the same request and there is no order to get wrong.
 * Typing a name that already exists selects it instead of refusing: a studio
 * should not be told a tag it can see is taken.
 */
export function TagPicker({
  leadId,
  tags,
  canEdit,
}: {
  leadId: string
  tags: readonly LeadTag[]
  canEdit: boolean
}) {
  const all = useTags()
  const save = useSetLeadTags()
  const create = useCreateTag()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
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

  const on = useMemo(() => new Set(tags.map((t) => t.id)), [tags])
  const needle = text.trim().toLowerCase()

  const options = useMemo(
    () =>
      (all.data ?? [])
        // A retired tag stays on the leads that carry it but is not offered
        // again — unless this lead already has it, in which case hiding it
        // would make the chip impossible to remove.
        .filter((t) => t.is_active || on.has(t.id))
        .filter((t) => !needle || t.name.toLowerCase().includes(needle)),
    [all.data, needle, on],
  )

  const exact = (all.data ?? []).some((t) => t.name.trim().toLowerCase() === needle)

  const setTags = (ids: string[]) => save.mutate({ id: leadId, tag_ids: ids })

  const toggle = (id: string) =>
    setTags(on.has(id) ? [...on].filter((x) => x !== id) : [...on, id])

  async function addNew() {
    const name = text.trim()
    if (!name) return
    const made = await create.mutateAsync({ name, color: 'blue' })
    setTags([...on, made.id])
    setText('')
  }

  return (
    <div ref={box} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={canEdit ? () => toggle(t.id) : undefined} />
        ))}
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <TagIcon /> {tags.length === 0 ? 'Add a tag' : 'Edit'}
          </Button>
        )}
        {!canEdit && tags.length === 0 && <span className="text-sm text-muted-foreground">No tags</span>}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && needle && !exact) {
                  e.preventDefault()
                  void addNew()
                }
              }}
              placeholder="Find or create a tag…"
              aria-label="Find or create a tag"
            />
          </div>

          <ul className="max-h-64 overflow-y-auto py-1">
            {options.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => toggle(t.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
                >
                  <Check className={cn('size-3.5 shrink-0', on.has(t.id) ? 'opacity-100' : 'opacity-0')} />
                  <TagChip tag={t} />
                  {t.lead_count > 0 && (
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">{t.lead_count}</span>
                  )}
                </button>
              </li>
            ))}
            {options.length === 0 && !needle && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No tags yet. Type one above.</li>
            )}
          </ul>

          {needle && !exact && (
            <button
              type="button"
              onClick={() => void addNew()}
              disabled={create.isPending}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <Plus className="size-3.5" /> Create “{text.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  )
}
