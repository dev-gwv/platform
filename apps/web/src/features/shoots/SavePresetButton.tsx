import { useState } from 'react'
import { Bookmark } from 'lucide-react'
import type { ShootPresetKind, ShootPresetPayload } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useSaveShootPreset } from './api'

/**
 * Save this shape under a name. The name field opens in place rather than in a
 * dialog: it is one short answer, and a modal over a wizard step is a lot of
 * ceremony for a text box.
 */
export function SavePresetButton({
  kind,
  defaultName,
  label,
  payload,
  disabled,
  disabledHint,
}: {
  kind: ShootPresetKind
  defaultName: string
  label: string
  payload: ShootPresetPayload
  /** Overrides the "nothing to save" rule: a shoot preset is worth saving by name alone. */
  disabled?: boolean
  disabledHint?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const save = useSaveShootPreset()
  const empty = disabled ?? (payload.requirements.length === 0 && payload.internal_work.length === 0)

  const submit = () => {
    if (!name.trim()) return
    save.mutate({ kind, name: name.trim(), payload }, { onSuccess: () => setOpen(false) })
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setName(defaultName)
          setOpen((v) => !v)
        }}
        disabled={empty}
        title={empty ? (disabledHint ?? 'Nothing to save yet') : label}
        aria-label={label}
      >
        <Bookmark /> <span className="hidden sm:inline">{label}</span>
      </Button>
      {open && (
        <div className="ipc-menu absolute right-0 top-full z-40 mt-2 flex w-64 items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-lg">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setOpen(false)
            }}
            aria-label="Preset name"
            placeholder="Preset name"
          />
          <Button size="sm" onClick={submit} disabled={!name.trim() || save.isPending}>
            Save
          </Button>
        </div>
      )}
    </div>
  )
}
