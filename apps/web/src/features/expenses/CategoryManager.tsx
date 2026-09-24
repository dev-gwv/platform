import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useActiveLookups, useCreateCustomLookup, useUpdateCustomLookup, useDeleteCustomLookup } from '@/features/settings/api'

/** Pick a studio-defined expense category, or add one inline without leaving the form (owner only). */
export function ExpenseCategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { session } = useAuth()
  const { data: categories } = useActiveLookups('expense_category')
  const createLookup = useCreateCustomLookup()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  async function onAdd() {
    if (!name.trim()) return
    await createLookup.mutateAsync({ category: 'expense_category', value: name.trim() })
    onChange(name.trim())
    setAdding(false)
    setName('')
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>New category</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Travel" autoFocus />
          <Button type="button" size="sm" onClick={() => void onAdd()} disabled={!name.trim() || createLookup.isPending}>
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
      <Label htmlFor="exp-category">Category</Label>
      <Select
        id="exp-category"
        value={value}
        onChange={(e) => {
          if (e.target.value === '__add__') setAdding(true)
          else onChange(e.target.value)
        }}
      >
        <option value="">Choose…</option>
        {value && !(categories ?? []).some((c) => c.value === value) && <option value={value}>{value}</option>}
        {(categories ?? []).map((c) => (
          <option key={c.id} value={c.value}>
            {c.value}
          </option>
        ))}
        {session?.is_owner && <option value="__add__">+ Add new category…</option>}
      </Select>
    </div>
  )
}

export function CategoryManager({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { session } = useAuth()
  const { data, isLoading, refetch } = useActiveLookups('expense_category')
  const create = useCreateCustomLookup()
  const update = useUpdateCustomLookup()
  const remove = useDeleteCustomLookup()
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  async function onAdd() {
    if (!name.trim()) return
    await create.mutateAsync({ category: 'expense_category', value: name.trim() })
    setName('')
    void refetch()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Expense categories" description="The studio's own words for where money goes: travel, prints, rent, gear.">
        <div className="flex flex-col gap-3">
          {session?.is_owner && (
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" />
              <Button size="sm" onClick={() => void onAdd()} disabled={!name.trim() || create.isPending}>
                Add
              </Button>
            </div>
          )}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border">
              {(data ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-2 p-2 text-sm">
                  {editingId === c.id ? (
                    <>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1" />
                      <Button
                        size="sm"
                        onClick={() => {
                          void update.mutateAsync({ id: c.id, patch: { value: editName.trim() } }).then(() => {
                            setEditingId(null)
                            void refetch()
                          })
                        }}
                        disabled={!editName.trim() || update.isPending}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 font-medium">{c.value}</span>
                      {session?.is_owner && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingId(c.id); setEditName(c.value) }}>
                            Rename
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { void remove.mutateAsync(c.id).then(() => void refetch()) }}>
                            Remove
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
              {(data ?? []).length === 0 && <li className="p-3 text-sm text-muted-foreground">No categories yet.</li>}
            </ul>
          )}
          <div className="flex justify-end">
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
