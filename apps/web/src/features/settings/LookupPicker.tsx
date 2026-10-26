import { useState, type KeyboardEvent } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { useActiveLookups } from './api'
import { useAddLookupWord, usePersonalWords } from './quick-words'

/**
 * A labelled dropdown over one of the studio's own lists, with a visible
 * "+ New" beside the label: type a name, press Enter, and it is saved to the
 * list and picked, without leaving the form. The same "+ Add new…" sits at the
 * foot of the dropdown for whoever looks there first.
 */
export function LookupPicker({
  category,
  value,
  onChange,
  label,
  id,
  emptyLabel = 'Choose…',
  noun = 'option',
  example,
}: {
  category: string
  value: string
  onChange: (v: string) => void
  label: string
  id?: string | undefined
  emptyLabel?: string
  /** "category", "mode": used in "+ Add new category…". */
  noun?: string
  example?: string
}) {
  const { data: items } = useActiveLookups(category)
  const mine = usePersonalWords(category)
  const addWord = useAddLookupWord(category)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const v = name.trim()
    if (!v) return
    setError(null)
    // Already on the list, perhaps in other capitals: just pick it.
    const existing = (items ?? []).find((i) => i.value.toLowerCase() === v.toLowerCase())
    if (existing) {
      onChange(existing.value)
    } else {
      try {
        setSaving(true)
        // The studio's list when allowed, else the person's own quick list.
        onChange(await addWord(v))
      } catch (e) {
        setError(e instanceof Error ? e.message : `Could not add the ${noun}.`)
        return
      } finally {
        setSaving(false)
      }
    }
    setAdding(false)
    setName('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    // Enter saves the new value; it must not submit the form around it.
    if (e.key === 'Enter') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={adding ? `${id ?? category}-new` : id}>{adding ? `New ${noun}` : label}</Label>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
          >
            <Plus className="size-3" aria-hidden /> New
          </button>
        )}
      </div>
      {adding ? (
        <div className="flex gap-1.5">
          <Input
            id={`${id ?? category}-new`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKey}
            placeholder={example ? `e.g. ${example}` : undefined}
            autoFocus
          />
          <Button type="button" size="icon" onClick={() => void save()} disabled={!name.trim() || saving} aria-label={`Save ${noun}`}>
            <Check />
          </Button>
          <Button type="button" size="icon" variant="outline" onClick={() => setAdding(false)} aria-label="Cancel">
            <X />
          </Button>
        </div>
      ) : (
        <Select
          id={id}
          value={value}
          onChange={(e) => {
            if (e.target.value === '__add__') setAdding(true)
            else onChange(e.target.value)
          }}
        >
          <option value="">{emptyLabel}</option>
          {/* A value saved before it was renamed or removed still shows its own text. */}
          {value && !(items ?? []).some((i) => i.value === value) && !mine.includes(value) && <option value={value}>{value}</option>}
          {(items ?? []).map((i) => (
            <option key={i.id} value={i.value}>
              {i.value}
            </option>
          ))}
          {/* The person's own words, kept from earlier picks. */}
          {mine
            .filter((w) => !(items ?? []).some((i) => i.value.toLowerCase() === w.toLowerCase()))
            .map((w) => (
              <option key={`mine:${w}`} value={w}>
                {w}
              </option>
            ))}
          <option value="__add__">+ Add new {noun}…</option>
        </Select>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
