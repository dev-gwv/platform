import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { isTouchScreen } from '@/shared/ui/touch'
import { PICKER_PAGE, pickedName } from '@/features/projects/ProjectPicker'
import { useClient, useClients } from './api'

/**
 * One way to pick a client in a filter: it asks the server as you type (name,
 * phone, email or city), twenty at a time, like ProjectPicker -- instead of
 * every client the studio ever had in a <select> (621 KB on each money page
 * of a studio with 2,000 clients, speed check 22 Nov).
 */
export function ClientPicker({
  value,
  onChange,
  noneLabel,
  placeholder = 'Choose a client',
  className,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (id: string, name: string | null) => void
  /** Offer a blank choice with this name ("All clients"). */
  noneLabel?: string | undefined
  placeholder?: string | undefined
  className?: string | undefined
  'aria-label'?: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)

  // One request per pause, not one per letter.
  useEffect(() => {
    const t = setTimeout(() => setTyped(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])

  // Asked only while open: a closed picker on a page costs nothing.
  const searched = useClients({ page: 1, page_size: PICKER_PAGE, sort: 'name', ...(typed ? { search: typed } : {}) }, { enabled: open })
  const page = searched.data && !Array.isArray(searched.data) ? searched.data.items : []
  const loaded = open ? page.map((c) => ({ id: c.id, name: c.name, hint: c.phone ?? c.city ?? null })) : []

  // Remember the last name chosen, so the trigger never blinks back to an id.
  const [chosenName, setChosenName] = useState<string | null>(null)
  const knownName = pickedName(value, chosenName, loaded)
  const detail = useClient(value && !knownName ? value : '')
  const shown = knownName ?? detail.data?.name ?? null

  function choose(next: string, name: string | null) {
    setChosenName(name)
    onChange(next, name)
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
          aria-label={ariaLabel}
          className={cn(
            'inline-flex h-9 w-full items-center gap-1.5 rounded-md border border-input bg-card px-3 text-left text-sm transition-colors hover:border-primary/40',
            className,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>
            {value ? (shown ?? 'Client') : (noneLabel ?? placeholder)}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          // On a phone the keyboard would cover the list (touch.ts).
          if (!isTouchScreen()) input.current?.focus()
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
                if (loaded.length === 1) choose(loaded[0]!.id, loaded[0]!.name)
              }
            }}
            placeholder="Search name or phone…"
            aria-label="Search clients"
            className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searched.isFetching && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
        </div>
        <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
          {noneLabel && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => choose('', null)}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted', !value && 'bg-muted/60 font-medium')}
              >
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{noneLabel}</span>
                {!value && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          )}
          {loaded.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === value}
                onClick={() => choose(c.id, c.name)}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted', c.id === value && 'bg-muted/60 font-medium')}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.hint && <span className="max-w-[40%] shrink-0 truncate text-[0.7rem] text-muted-foreground">{c.hint}</span>}
                {c.id === value && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          ))}
          {!searched.isFetching && loaded.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">{typed ? 'No client matches.' : 'No clients yet.'}</li>
          )}
          {loaded.length === PICKER_PAGE && (
            <li className="px-3 py-1.5 text-[0.7rem] text-muted-foreground">Showing the first {PICKER_PAGE}. Type to find others.</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
