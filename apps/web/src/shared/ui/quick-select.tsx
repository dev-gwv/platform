import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Loader2, Plus, Search } from 'lucide-react'
import { cn } from './cn'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { TONES, TONE_BG, TONE_CHIP, type ToneName } from './tones'

export interface QuickOption {
  value: string
  label: string
  color?: ToneName | null | undefined
  /** Drawn before the label instead of a dot: an EventTile, an avatar. */
  icon?: ReactNode
  /** A quiet second line: "3 leads", "ranks calls". */
  hint?: string | undefined
}

/**
 * One way to pick from any of a studio's lists, and to grow it on the spot.
 *
 * The owner's rule: no closed field. A quality, a source, a stage, a
 * follow-up type -- whatever the list, the word a studio needs is typed where
 * it is needed and chosen at once, with a colour if the list has colours. The
 * reference app did this with four different controls; this is one.
 *
 * The trigger is a chip in the option's colour when it has one ("Hot" in
 * rose), so the field reads at a glance; `variant="field"` draws it as a
 * form input instead, for dialogs.
 */
export function QuickSelect({
  value,
  onChange,
  options,
  onCreate,
  placeholder = 'Choose…',
  noun = 'option',
  colors = false,
  clearable = false,
  disabled = false,
  variant = 'chip',
  className,
  'aria-label': ariaLabel,
  id,
}: {
  value: string | null
  onChange: (value: string | null) => void
  options: readonly QuickOption[]
  /** Save a new option; resolve with the value to select. Omit to disallow adding. */
  onCreate?: ((label: string, color: ToneName | null) => Promise<string> | string) | undefined
  placeholder?: string | undefined
  /** "+ Add new {noun}". */
  noun?: string | undefined
  /** Offer a colour when adding. */
  colors?: boolean | undefined
  clearable?: boolean | undefined
  disabled?: boolean | undefined
  variant?: 'chip' | 'field' | undefined
  className?: string | undefined
  'aria-label'?: string | undefined
  id?: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<ToneName>('blue')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const current = options.find((o) => o.value === value) ?? (value ? { value, label: value } : null)
  const needle = q.trim().toLowerCase()
  const shown = useMemo(
    () => (needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options),
    [options, needle],
  )
  const exact = options.find((o) => o.label.toLowerCase() === needle)
  const canAdd = !!onCreate && needle.length > 0 && !exact

  function choose(v: string | null) {
    onChange(v)
    setOpen(false)
    setQ('')
  }

  async function add() {
    const label = q.trim()
    if (!label || !onCreate) return
    try {
      setBusy(true)
      const v = await onCreate(label, colors ? pick : null)
      choose(v)
    } finally {
      setBusy(false)
    }
  }

  const tone = current?.color ?? null
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
            'inline-flex max-w-full items-center gap-1.5 text-left transition-colors disabled:opacity-60',
            variant === 'chip'
              ? cn(
                  'h-7 rounded-full border px-2.5 text-xs font-medium',
                  current
                    ? tone
                      ? TONE_CHIP[tone]
                      : 'border-border bg-card text-foreground'
                    : // Empty and wanting a value: the owner's amber nudge.
                      'border-dashed border-tone-amber/60 bg-tone-amber-soft/40 text-tone-amber',
                  'hover:brightness-95',
                )
              : 'h-9 w-full rounded-md border border-input bg-card px-3 text-sm hover:border-primary/40',
            className,
          )}
        >
          {current?.icon ?? (tone && variant === 'field' ? <span className={cn('size-2 shrink-0 rounded-full', TONE_BG[tone])} /> : null)}
          <span className={cn('min-w-0 flex-1 truncate', !current && variant === 'field' && 'text-muted-foreground')}>
            {current ? current.label : placeholder}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
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
                if (exact) choose(exact.value)
                else if (canAdd) void add()
                else if (shown.length === 1) choose(shown[0]!.value)
              }
            }}
            placeholder={onCreate ? `Search or add a ${noun}…` : `Search…`}
            className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
          {clearable && value && (
            <li>
              <button
                type="button"
                onClick={() => choose(null)}
                className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
              >
                Clear
              </button>
            </li>
          )}
          {shown.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => choose(o.value)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted',
                  o.value === value && 'bg-muted/60 font-medium',
                )}
              >
                {o.icon ?? <span className={cn('size-2.5 shrink-0 rounded-full', TONE_BG[o.color ?? 'slate'])} aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-[0.7rem] text-muted-foreground">{o.hint}</span>}
                {o.value === value && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          ))}
          {shown.length === 0 && !canAdd && (
            <li className="px-3 py-2 text-xs text-muted-foreground">Nothing matches.</li>
          )}
        </ul>

        {onCreate && (
          <div className="border-t border-border p-2">
            {canAdd ? (
              <div className="flex flex-col gap-2">
                {colors && (
                  <div className="flex items-center gap-1.5 px-1" role="radiogroup" aria-label="Colour">
                    {TONES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={pick === t}
                        aria-label={t}
                        onClick={() => setPick(t)}
                        className={cn(
                          'size-5 rounded-full ring-offset-2 ring-offset-card transition',
                          TONE_BG[t],
                          pick === t ? 'ring-2 ring-foreground' : 'hover:scale-110',
                        )}
                      />
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 text-left text-sm font-medium text-primary hover:bg-primary/15"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  <span className="truncate">Add “{q.trim()}”</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => input.current?.focus()}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary hover:bg-primary/10"
              >
                <Plus className="size-3.5" />
                Add new {noun}
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
