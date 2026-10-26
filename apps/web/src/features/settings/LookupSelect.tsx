import { useMemo } from 'react'
import { CreatableSelect, type CreatableOption } from '@/shared/ui/creatable-select'
import { useActiveLookups } from './api'
import { useAddLookupWord, usePersonalWords } from './quick-words'

/**
 * A dropdown of one of the studio's own lists (Settings → Lists) that can
 * grow from wherever it is used: "+ Add new…" types the option, picks it,
 * and saves it to the list so everyone sees it next time.
 *
 * `defaults` are the built-in choices shown before the studio has added any
 * of its own. Saving to the list needs create access where the list is
 * used (see LOOKUP_QUICK_ADD); anyone else keeps the typed option on their own
 * quick list, offered to them next time (owner, 26 Oct).
 */
export function LookupSelect({
  category,
  value,
  onChange,
  defaults = [],
  placeholder,
  addLabel = 'Add new…',
  inputPlaceholder,
  id,
  className,
  'aria-label': ariaLabel,
}: {
  category: string
  value: string
  onChange: (value: string) => void
  defaults?: readonly CreatableOption[] | undefined
  placeholder?: string | undefined
  addLabel?: string | undefined
  inputPlaceholder?: string | undefined
  id?: string | undefined
  className?: string | undefined
  'aria-label'?: string | undefined
}) {
  const lookups = useActiveLookups(category)
  const mine = usePersonalWords(category)
  const addWord = useAddLookupWord(category)

  const options = useMemo(() => {
    const out: CreatableOption[] = [...defaults]
    for (const l of lookups.data ?? []) {
      const seen = out.some(
        (o) => o.value.toLowerCase() === l.value.toLowerCase() || o.label.toLowerCase() === l.value.toLowerCase(),
      )
      if (!seen) out.push({ value: l.value, label: l.value })
    }
    // The person's own words, kept from earlier picks (quick list).
    for (const w of mine) {
      if (!out.some((o) => o.value.toLowerCase() === w.toLowerCase() || o.label.toLowerCase() === w.toLowerCase())) out.push({ value: w, label: w })
    }
    return out
  }, [defaults, lookups.data, mine])

  return (
    <CreatableSelect
      id={id}
      aria-label={ariaLabel}
      className={className}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      addLabel={addLabel}
      inputPlaceholder={inputPlaceholder}
      onCreate={(label) => addWord(label)}
    />
  )
}
