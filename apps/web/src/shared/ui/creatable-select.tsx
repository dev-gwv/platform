import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { Button } from './button'
import { Input } from './input'
import { Select } from './select'

export interface CreatableOption {
  value: string
  label: string
}

const ADD = '__add_new__'

/**
 * A dropdown whose last choice is "+ Add new…".
 *
 * A studio's lists never match anyone's defaults for long: a data type of
 * "Reels", a disk called "Portable SSD", an expense category nobody thought
 * of. A fixed dropdown sends them to a settings page they may not know
 * exists, or to picking "Other" and losing the detail. Here the new option is
 * typed where it is needed, chosen straight away, and -- when the caller
 * saves it somewhere (onCreate) -- offered next time.
 *
 * Without onCreate the typed text simply becomes the value, which suits a
 * free-text column; the caller includes values it has seen before in
 * `options` so a custom entry comes back as a choice.
 */
export function CreatableSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  addLabel = 'Add new…',
  inputPlaceholder = 'Type a name',
  onCreate,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string | undefined
  value: string
  onChange: (value: string) => void
  options: readonly CreatableOption[]
  /** An empty first option, e.g. "Pick one". Omit when a value is always set. */
  placeholder?: string | undefined
  addLabel?: string | undefined
  inputPlaceholder?: string | undefined
  /** Persist the new option; resolve with the value to select. */
  onCreate?: ((label: string) => Promise<string> | string) | undefined
  className?: string | undefined
  'aria-label'?: string | undefined
}) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<CreatableOption[]>([])

  // A value that is not among the options (typed earlier, or saved on an old
  // record) is still shown as itself rather than as a blank dropdown.
  const known = [...options, ...local.filter((l) => !options.some((o) => o.value === l.value))]
  const all = value && !known.some((o) => o.value === value) ? [...known, { value, label: value }] : known

  async function commit() {
    const label = text.trim()
    if (!label) return
    // Typing the name of an option that already exists just picks it.
    const existing = all.find((o) => o.label.toLowerCase() === label.toLowerCase())
    if (existing) {
      onChange(existing.value)
      setAdding(false)
      setText('')
      return
    }
    try {
      setBusy(true)
      const next = onCreate ? await onCreate(label) : label
      setLocal((l) => [...l, { value: next, label }])
      onChange(next)
      setAdding(false)
      setText('')
    } finally {
      setBusy(false)
    }
  }

  if (adding) {
    return (
      <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
        <Input
          id={id}
          aria-label={ariaLabel ? `New ${ariaLabel.toLowerCase()}` : 'New option'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={inputPlaceholder}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setAdding(false)
            }
          }}
        />
        <Button type="button" size="icon" className="size-9 shrink-0" disabled={!text.trim() || busy} onClick={() => void commit()} aria-label="Add">
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0" onClick={() => setAdding(false)} aria-label="Cancel">
          <X />
        </Button>
      </div>
    )
  }

  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      className={className}
      value={value}
      onChange={(e) => (e.target.value === ADD ? setAdding(true) : onChange(e.target.value))}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {all.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      <option value={ADD}>+ {addLabel}</option>
    </Select>
  )
}

