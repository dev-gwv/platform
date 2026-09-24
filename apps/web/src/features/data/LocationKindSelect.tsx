import type { StorageLocation, StorageLocationKind } from '@ipc/contracts'
import { CreatableSelect, type CreatableOption } from '@/shared/ui/creatable-select'
import { useStorageLocations } from './api'

export const LOCATION_KINDS: { value: StorageLocationKind; label: string }[] = [
  { value: 'drive', label: 'Hard disk / SSD' },
  { value: 'nas', label: 'NAS' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'other', label: 'Other' },
]

const isKind = (v: string): v is StorageLocationKind => LOCATION_KINDS.some((k) => k.value === v)

/**
 * A location's type as one value: one of the four kinds the database knows,
 * or the studio's own name for it ("Portable SSD"), which is stored as
 * location_type on an "other" location.
 */
export const kindValueOf = (loc: Pick<StorageLocation, 'kind' | 'location_type'>): string =>
  loc.location_type?.trim() && loc.kind === 'other' ? loc.location_type.trim() : loc.kind

export const kindLabelOf = (loc: Pick<StorageLocation, 'kind' | 'location_type'>): string => {
  const v = kindValueOf(loc)
  return LOCATION_KINDS.find((k) => k.value === v)?.label ?? v
}

/** The fields to save for a chosen type value. */
export const kindFields = (value: string): { kind: StorageLocationKind; location_type: string | null } =>
  isKind(value) ? { kind: value, location_type: null } : { kind: 'other', location_type: value }

/** Pick a location type, or add the studio's own. */
export function LocationKindSelect({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className?: string | undefined
}) {
  const locations = useStorageLocations()
  const custom = [
    ...new Set(
      (locations.data ?? [])
        .filter((l) => l.kind === 'other')
        .map((l) => l.location_type?.trim())
        .filter((t): t is string => !!t),
    ),
  ]
  const options: CreatableOption[] = [
    ...LOCATION_KINDS,
    ...custom
      .filter((t) => !LOCATION_KINDS.some((k) => k.label.toLowerCase() === t.toLowerCase()))
      .map((t) => ({ value: t, label: t })),
  ]
  return (
    <CreatableSelect
      aria-label="Kind"
      value={value}
      onChange={onChange}
      options={options}
      addLabel="Add a type…"
      inputPlaceholder="e.g. Portable SSD"
      className={className}
    />
  )
}
