import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { useAuth } from '@/shared/auth/AuthProvider'
import { LookupPicker } from '@/features/settings/LookupPicker'
import { useCanAddLookup } from '@/features/settings/useCanAddLookup'
import { useActiveLookups, useCreateCustomLookup, useUpdateCustomLookup, useDeleteCustomLookup } from '@/features/settings/api'

/** Pick a studio-defined expense category, or add one inline without leaving the form. */
export function ExpenseCategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <LookupPicker category="expense_category" id="exp-category" value={value} onChange={onChange} label="Category" noun="category" example="Travel" />
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
  const canAdd = useCanAddLookup('expense_category')

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
          {canAdd && (
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
