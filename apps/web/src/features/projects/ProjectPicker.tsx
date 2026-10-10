import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { useClientProjects } from '@/features/clients/api'
import { useProject, useProjects } from './api'

/** How many matches the server sends at a time. */
export const PICKER_PAGE = 20

/**
 * The project the picker shows as chosen: the name the caller already has,
 * then a match in what was loaded, then the project itself (one small read,
 * only when nothing else knows its name).
 */
export function pickedName(
  value: string,
  known: string | null | undefined,
  loaded: readonly { id: string; name: string }[],
): string | null {
  if (!value) return null
  return known || loaded.find((p) => p.id === value)?.name || null
}

/**
 * One way to pick a project, wherever a studio picks one: it asks the server
 * as you type (name, client or phone), twenty at a time, instead of loading
 * every project the studio has ever had into each dialog and filter. Given a
 * client, it lists only that client's projects.
 */
export function ProjectPicker({
  value,
  onChange,
  label,
  clientId,
  placeholder = 'Choose a project',
  noneLabel,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (id: string, name: string | null) => void
  /** The chosen project's name, when the caller already knows it. */
  label?: string | null | undefined
  /** Only this client's projects. */
  clientId?: string | undefined
  placeholder?: string | undefined
  /** Offer a blank choice with this name ("All projects", "No project"). */
  noneLabel?: string | undefined
  disabled?: boolean | undefined
  className?: string | undefined
  id?: string | undefined
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

  const byClient = useClientProjects(open && clientId ? clientId : '')
  // Asked only while open: a closed picker on a page costs nothing.
  const searched = useProjects(
    { page: 1, page_size: PICKER_PAGE, ...(typed ? { search: typed } : {}) },
    { enabled: open && !clientId },
  )
  const loaded: { id: string; name: string; hint?: string | null }[] = clientId
    ? (byClient.data ?? [])
        .filter((p) => !typed || p.name.toLowerCase().includes(typed.toLowerCase()))
        .map((p) => ({ id: p.id, name: p.name }))
    : open
      ? (searched.data ?? []).map((p) => ({ id: p.id, name: p.name, hint: p.client_name }))
      : []
  const loading = clientId ? byClient.isLoading : searched.isFetching

  // Remember the last name chosen, so the trigger never blinks back to an id.
  const [chosenName, setChosenName] = useState<string | null>(null)
  const knownName = pickedName(value, label ?? chosenName, loaded)
  const detail = useProject(value && !knownName ? value : '')
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
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          className={cn(
            'inline-flex h-9 w-full items-center gap-1.5 rounded-md border border-input bg-card px-3 text-left text-sm transition-colors hover:border-primary/40 disabled:opacity-60',
            className,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>
            {value ? (shown ?? 'Project') : (noneLabel ?? placeholder)}
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
                if (loaded.length === 1) choose(loaded[0]!.id, loaded[0]!.name)
              }
            }}
            placeholder={clientId ? 'Search their projects…' : 'Search project, client or phone…'}
            aria-label="Search projects"
            className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
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
          {loaded.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={p.id === value}
                onClick={() => choose(p.id, p.name)}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted', p.id === value && 'bg-muted/60 font-medium')}
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.hint && <span className="max-w-[40%] shrink-0 truncate text-[0.7rem] text-muted-foreground">{p.hint}</span>}
                {p.id === value && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          ))}
          {!loading && loaded.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">{typed ? 'No project matches.' : 'No projects yet.'}</li>
          )}
          {!clientId && loaded.length === PICKER_PAGE && (
            <li className="px-3 py-1.5 text-[0.7rem] text-muted-foreground">Showing the newest {PICKER_PAGE}. Type to find others.</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
