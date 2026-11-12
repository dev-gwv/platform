import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { SEARCH_MIN, useLead, useLeadSearch, useRecentLeads } from './api'

const PAGE = 20

/** How a lead reads in a picker: its name, else its number. */
export const leadLabel = (l: { name: string | null; phone: string | null }): string =>
  l.name?.trim() || l.phone?.trim() || 'Unnamed lead'

/**
 * Pick a lead by typing, the way ProjectPicker picks a project: the server is
 * asked as you type (name, phone, email), never the studio's whole lead book.
 * Before anything is typed it offers the newest open leads.
 */
export function LeadPicker({
  value,
  onChange,
  placeholder = 'Choose a lead',
  className,
  id,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (id: string | null) => void
  placeholder?: string | undefined
  className?: string | undefined
  id?: string | undefined
  'aria-label'?: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setTyped(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])

  const searching = typed.length >= SEARCH_MIN
  const found = useLeadSearch(open && searching ? typed : '')
  const recent = useRecentLeads(open && !searching, PAGE)
  const loaded = (searching ? found.data : recent.data) ?? []
  const loading = searching ? found.isFetching : recent.isFetching

  const [chosen, setChosen] = useState<string | null>(null)
  const knownName = loaded.find((l) => l.id === value)
  const detail = useLead(value && !chosen && !knownName ? value : null)
  const shown = chosen ?? (knownName ? leadLabel(knownName) : detail.data ? leadLabel(detail.data) : null)

  function choose(next: string | null, name: string | null) {
    setChosen(name)
    onChange(next)
    setOpen(false)
    setQ('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          className={cn(
            'inline-flex h-9 w-full items-center gap-1.5 rounded-md border border-input bg-card px-3 text-left text-sm transition-colors hover:border-primary/40',
            className,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>
            {value ? (shown ?? 'Lead') : placeholder}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          input.current?.focus()
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (loaded.length === 1) choose(loaded[0]!.id, leadLabel(loaded[0]!))
              }
            }}
            placeholder="Search name, phone or email…"
            aria-label="Search leads"
            className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
        </div>
        <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
          {value && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => choose(null, null)}
                className="flex w-full items-center px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
              >
                No lead
              </button>
            </li>
          )}
          {loaded.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                role="option"
                aria-selected={l.id === value}
                onClick={() => choose(l.id, leadLabel(l))}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted', l.id === value && 'bg-muted/60 font-medium')}
              >
                <span className="min-w-0 flex-1 truncate">{leadLabel(l)}</span>
                {l.name && l.phone && <span className="max-w-[40%] shrink-0 truncate text-[0.7rem] text-muted-foreground">{l.phone}</span>}
                {l.id === value && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          ))}
          {!loading && loaded.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">{searching ? 'No lead matches.' : 'No open leads yet.'}</li>
          )}
          {!searching && loaded.length === PAGE && (
            <li className="px-3 py-1.5 text-[0.7rem] text-muted-foreground">Showing the newest {PAGE}. Type to find others.</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
