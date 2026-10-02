import { useState } from 'react'
import { Check, UserPlus } from 'lucide-react'
import type { DeliverableWorkload, TeamMember } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/ui/cn'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useMembers } from '@/features/allocation/api'
import { orderPeople, workloadText } from '@/features/projects/give-work'

/**
 * The people to give work to: editors first, then whoever has least on, each
 * with how much they already have ("2 in hand · 1 late"). A search box once
 * the team is big. "Me" sits at the top for the person doing it themselves.
 */
export function PersonList({
  selected,
  onPick,
  load,
  showLoad = true,
  className,
}: {
  selected: string | null
  onPick: (member: TeamMember) => void
  load?: ReadonlyMap<string, DeliverableWorkload> | undefined
  showLoad?: boolean
  className?: string
}) {
  const { data: members } = useMembers()
  const { session } = useAuth()
  const [find, setFind] = useState('')
  const all = members ?? []
  const loads = load ?? new Map<string, DeliverableWorkload>()
  const me = all.find((m) => m.user_id === session?.user_id)
  const people = orderPeople(
    all.filter((m) => m.user_id !== me?.user_id && (!find || m.name.toLowerCase().includes(find.toLowerCase()))),
    loads,
  )
  const shown = me && (!find || 'me'.includes(find.toLowerCase()) || me.name.toLowerCase().includes(find.toLowerCase())) ? [me, ...people] : people

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {all.length > 8 && (
        <input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find someone"
          aria-label="Find someone"
          className="h-9 w-full rounded-full border border-input bg-background px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="People">
        {shown.map((m) => {
          const on = m.user_id === selected
          const w = loads.get(m.user_id)
          return (
            <button
              key={m.user_id}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => onPick(m)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                on ? 'border-success/50 bg-success/10' : 'border-transparent hover:border-border hover:bg-muted',
              )}
            >
              <Avatar name={m.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {m.user_id === me?.user_id ? `Me (${m.name.split(' ')[0]})` : m.name}
                </span>
                {m.role_names.length > 0 && <span className="block truncate text-[11px] text-muted-foreground">{m.role_names.join(', ')}</span>}
              </span>
              {showLoad && (
                <span
                  className={cn(
                    'shrink-0 text-[11px] font-medium',
                    (w?.late ?? 0) > 0 ? 'text-destructive' : (w?.open ?? 0) === 0 ? 'text-success' : 'text-muted-foreground',
                  )}
                >
                  {workloadText(w)}
                </span>
              )}
              {on && <Check className="size-4 shrink-0 text-success" aria-hidden />}
            </button>
          )
        })}
        {shown.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">No one by that name.</p>}
      </div>
    </div>
  )
}

/**
 * A person, picked in place: a chip with their face, or an amber dashed
 * "Assign" while nobody is on it. For lists where a whole dialog is too much
 * (a task row).
 */
export function PersonChip({
  value,
  name,
  onChange,
  label = 'Assign',
  disabled,
}: {
  value: string | null
  name: string | null | undefined
  onChange: (userId: string | null) => void
  label?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={name ? `Assigned to ${name}` : label}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors',
            name
              ? 'border-border bg-card text-foreground/85 hover:bg-muted'
              : 'border-dashed border-warning/70 bg-warning/10 text-warning hover:bg-warning/15',
          )}
        >
          {name ? <Avatar name={name} size="sm" /> : <UserPlus className="size-3.5" aria-hidden />}
          {name ?? label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" onClick={(e) => e.stopPropagation()}>
        <PersonList
          selected={value}
          showLoad={false}
          onPick={(m) => {
            setOpen(false)
            onChange(m.user_id === value ? null : m.user_id)
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onChange(null)
            }}
            className="mt-1 w-full rounded-lg border-t border-border px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Take them off it
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
