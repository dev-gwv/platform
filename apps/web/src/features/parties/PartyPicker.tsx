import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Label, Select, Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { useParties, useCreateParty, useUpdateParty } from './api'

/** Pick an existing vendor/freelancer, or add one inline without leaving the form. */
export function PartyPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data: parties } = useParties()
  const create = useCreateParty()
  const update = useUpdateParty()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'vendor' | 'freelancer' | 'other'>('vendor')

  const selected = (parties ?? []).find((p) => p.id === value)

  async function onAdd() {
    if (!name.trim()) return
    const created = await create.mutateAsync({ name: name.trim(), kind })
    onChange(created.id)
    setAdding(false)
    setName('')
  }

  function startEdit() {
    if (!selected) return
    setName(selected.name)
    setKind(selected.kind)
    setEditing(true)
  }

  async function onSaveEdit() {
    if (!selected || !name.trim()) return
    await update.mutateAsync({ id: selected.id, patch: { name: name.trim(), kind } })
    setEditing(false)
  }

  if (editing && selected) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>Edit party</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor or freelancer name" autoFocus />
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-32">
            <option value="vendor">Vendor</option>
            <option value="freelancer">Freelancer</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => void onSaveEdit()} disabled={!name.trim() || update.isPending}>
            Save
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>New party</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor or freelancer name" autoFocus />
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-32">
            <option value="vendor">Vendor</option>
            <option value="freelancer">Freelancer</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => void onAdd()} disabled={!name.trim() || create.isPending}>
            Add
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Party (vendor / freelancer)</Label>
      <div className="flex gap-2">
        <Select
          value={value}
          onChange={(e) => {
            if (e.target.value === '__add__') setAdding(true)
            else onChange(e.target.value)
          }}
        >
          <option value="">Optional</option>
          {/* Archived vendors leave the list, unless this expense already names one. */}
          {(parties ?? []).filter((p) => p.is_active !== false || p.id === value).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="__add__">+ Add new party…</option>
        </Select>
        {selected && (
          <Button type="button" size="icon" variant="outline" title="Edit party" onClick={startEdit}>
            <Pencil />
          </Button>
        )}
      </div>
    </div>
  )
}
