import { useState, type FormEvent } from 'react'
import { Archive, ArchiveRestore, Check, Pencil, Plus, X } from 'lucide-react'
import type { DataPerson } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useCreateDataPerson, useDataPeople, useUpdateDataPerson } from './api'

/**
 * The people outside the team who copy cards -- an assistant's cousin, a
 * freelance DIT. They are added from the data dialog's "Copied by" as the
 * studio meets them; this is where a name is fixed, a phone added, or someone
 * who no longer helps is archived. Archived helpers leave the picker but keep
 * every record they copied.
 */
export function HelpersTab() {
  const people = useDataPeople()
  const create = useCreateDataPerson()
  const [name, setName] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  if (people.isLoading) return <SkeletonList rows={3} columns={3} />
  if (people.isError) return <ErrorState onRetry={() => void people.refetch()} />

  const all = people.data ?? []
  const active = all.filter((p) => p.is_active)
  const archived = all.filter((p) => !p.is_active)

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    await create.mutateAsync({ name: n })
    setName('')
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={(e) => void onAdd(e)} className="flex flex-wrap gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name of someone who copies cards"
          aria-label="New helper's name"
          maxLength={120}
          className={cn('max-w-sm', !name && 'border-warning/60')}
        />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <Plus /> Add helper
        </Button>
      </form>

      {active.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No outside helpers yet. Your team is always in “Copied by”; add anyone else here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {active.map((p) => (
            <HelperRow key={p.id} person={p} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            Archived ({archived.length}) {showArchived ? '▾' : '▸'}
          </button>
          {showArchived && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {archived.map((p) => (
                <HelperRow key={p.id} person={p} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function HelperRow({ person }: { person: DataPerson }) {
  const update = useUpdateDataPerson()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(person.name)
  const [role, setRole] = useState(person.role ?? '')
  const [phone, setPhone] = useState(person.phone ?? '')

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await update.mutateAsync({ id: person.id, name: name.trim(), role: role.trim(), phone: phone.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-primary/40 bg-card p-2">
        <form onSubmit={(e) => void onSave(e)} className="flex flex-wrap items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={120} className="w-48" autoFocus />
          <Input value={role} onChange={(e) => setRole(e.target.value)} aria-label="What they do" placeholder="What they do" maxLength={80} className="w-40" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" placeholder="Phone" inputMode="tel" maxLength={20} className="w-36" />
          <Button type="submit" size="sm" disabled={!name.trim() || update.isPending}>
            <Check /> Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            <X /> Cancel
          </Button>
        </form>
      </li>
    )
  }

  return (
    <li className={cn('flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2', !person.is_active && 'opacity-70')}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{person.name}</p>
        {(person.role || person.phone) && (
          <p className="truncate text-xs text-muted-foreground">{[person.role, person.phone].filter(Boolean).join(' · ')}</p>
        )}
      </div>
      {person.is_active && (
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          <Pencil /> Edit
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={update.isPending}
        onClick={() => update.mutate({ id: person.id, is_active: !person.is_active })}
        title={person.is_active ? 'Leaves the Copied by list; their records stay' : 'Back in the Copied by list'}
      >
        {person.is_active ? (
          <>
            <Archive /> Archive
          </>
        ) : (
          <>
            <ArchiveRestore /> Bring back
          </>
        )}
      </Button>
    </li>
  )
}
