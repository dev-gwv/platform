import { useMemo } from 'react'
import { useCanAddLookup } from './useCanAddLookup'
import { CreatableSelect, type CreatableOption } from '@/shared/ui/creatable-select'
import { useActiveLookups, useCreateCustomLookup } from './api'

/**
 * A dropdown of one of the studio's own lists (Settings → Lookups) that can
 * grow from wherever it is used: "+ Add new…" types the option, picks it,
 * and saves it to the list so everyone sees it next time.
 *
 * `defaults` are the built-in choices shown before the studio has added any
 * of its own. Saving to the list needs create access where the list is
 * used (see LOOKUP_QUICK_ADD), so for anyone else the typed option is used on this record
 * without joining the list -- they are never stuck at "Other".
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
  const canAdd = useCanAddLookup(category)
  const lookups = useActiveLookups(category)
  const create = useCreateCustomLookup()

  const options = useMemo(() => {
    const out: CreatableOption[] = [...defaults]
    for (const l of lookups.data ?? []) {
      const seen = out.some(
        (o) => o.value.toLowerCase() === l.value.toLowerCase() || o.label.toLowerCase() === l.value.toLowerCase(),
      )
      if (!seen) out.push({ value: l.value, label: l.value })
    }
    return out
  }, [defaults, lookups.data])

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
      onCreate={async (label) => {
        if (canAdd) await create.mutateAsync({ category, value: label })
        return label
      }}
    />
  )
}
