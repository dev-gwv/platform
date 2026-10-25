import { useMemo, useState } from 'react'
import { Check, ChevronDown, Search, UserPlus, UserRound } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/ui/cn'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useMembers } from '@/features/allocation/api'

/**
 * Who has this lead, at the top of the drawer (owner, 25 Oct: "the lead
 * assigning module is not there" -- it was an Owner box down in Overview).
 * Amber and dashed while nobody has it, green once someone does; one tap
 * lists the team with a search. The person given it is told (0282).
 */
export function AssigneeChip({
  value,
  onChange,
  disabled,
}: {
  value: string | null
  onChange: (userId: string | null) => void
  disabled?: boolean
}) {
  const { session } = useAuth()
  const members = useMembers()
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  const list = useMemo(() => {
    // Only someone who can sign in can work a lead.
    const all = (members.data ?? []).filter((m) => m.login_enabled || m.user_id === value)
    const w = find.trim().toLowerCase()
    return w ? all.filter((m) => m.name.toLowerCase().includes(w)) : all
  }, [members.data, find])
  const current = (members.data ?? []).find((m) => m.user_id === value)
  const me = session?.user_id

  const pick = (id: string | null) => {
    setOpen(false)
    setFind('')
    if (id !== value) onChange(id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={current ? `Given to ${current.name}. Change` : 'Give this lead to someone'}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors disabled:opacity-60',
            current
              ? 'border-success/40 bg-success/10 text-foreground hover:border-success'
              : 'border-dashed border-warning/70 bg-warning/10 text-warning hover:border-warning',
          )}
        >
          {current ? <UserRound className="size-4 text-success" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
          {current ? (
            <>
              <span className="font-normal text-muted-foreground">Given to</span> {current.user_id === me ? 'you' : current.name}
            </>
          ) : (
            'Give to someone'
          )}
          {!disabled && <ChevronDown className="size-3.5 opacity-70" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        {(members.data?.length ?? 0) > 7 && (
          <span className="relative mb-2 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a person" className="h-9 pl-8" />
          </span>
        )}
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {me && !find && value !== me && (members.data ?? []).some((m) => m.user_id === me) && (
            <Row label="Me" on={false} onClick={() => pick(me)} />
          )}
          {list.map((m) => (
            <Row key={m.user_id} label={m.user_id === me ? `${m.name} (you)` : m.name} on={m.user_id === value} onClick={() => pick(m.user_id)} />
          ))}
          {value && !find && <Row label="Nobody" on={false} muted onClick={() => pick(null)} />}
          {list.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">Nobody by that name.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function Row({ label, on, muted, onClick }: { label: string; on: boolean; muted?: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted',
          on && 'font-semibold',
          muted && 'text-muted-foreground',
        )}
      >
        <Check className={cn('size-4 text-success', !on && 'invisible')} aria-hidden />
        {label}
      </button>
    </li>
  )
}
