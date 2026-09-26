import { useRef, useState, type ComponentProps, type FocusEvent } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { cn } from './cn'
import { Calendar } from './calendar'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

/**
 * The date box, in the app's own clothes.
 *
 * A native date input opens the browser's calendar: grey system font, square
 * corners, a different look in every browser. This shows the date the way a
 * person says it ("Wed, 24 Sept 2026") and opens our calendar under it, with
 * Today and Clear one tap away and a box to type a date for anyone quicker on
 * the keyboard.
 *
 * It keeps the native element's contract, because seventy-odd forms already
 * speak it: `value` / `defaultValue` as YYYY-MM-DD, `onChange` reading
 * `e.target.value`, `min`, `max`, `name`, `required`. A real <input
 * type="date"> stays in the DOM, visually hidden, holding the value and firing
 * the events, so form posts and React's controlled value behave as before.
 * Callers that save on blur get their onBlur when the calendar closes.
 */

const pad = (n: number) => String(n).padStart(2, '0')
export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function fromIso(iso: string | null | undefined): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** "24/09/2026", "24-9-26", "24.09.2026" → 2026-09-24. Day first, as India writes it. */
export function parseTyped(text: string, now = new Date()): string | null {
  const m = /^\s*(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})\s*$/.exec(text)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  let year = Number(m[3])
  if (m[3]!.length === 2) year += Math.floor(now.getFullYear() / 100) * 100
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return toIso(d)
}

/** "Wed, 24 Sept 2026" -- how a person says it, without the locale's stray commas. */
export function niceDate(iso: string): string {
  const d = fromIso(iso)
  if (!d) return iso
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-IN', o)
  return `${part({ weekday: 'short' })}, ${d.getDate()} ${part({ month: 'short' })} ${d.getFullYear()}`
}

export interface QuickDate {
  label: string
  iso: string
  /** False when the date falls outside the field's min/max: shown greyed, not hidden. */
  ok: boolean
}

/**
 * The dates people reach for without looking at a grid: today, tomorrow, and
 * the coming Saturday and Sunday — most shoots land on a weekend. The
 * weekend days are the ones strictly after tomorrow, so on a Friday the
 * chips read Today · Tomorrow · Sun 5 Oct, never "Tomorrow" and "Sat" twice.
 */
export function quickDates(now: Date, min?: Date, max?: Date): QuickDate[] {
  const day = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    return d
  }
  const short = (d: Date) =>
    `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`
  const within = (d: Date) => (!min || toIso(d) >= toIso(min)) && (!max || toIso(d) <= toIso(max))
  const out: QuickDate[] = [
    { label: 'Today', iso: toIso(day(0)), ok: within(day(0)) },
    { label: 'Tomorrow', iso: toIso(day(1)), ok: within(day(1)) },
  ]
  for (const dow of [6, 0]) {
    let offset = 2
    while (day(offset).getDay() !== dow) offset++
    const d = day(offset)
    out.push({ label: short(d), iso: toIso(d), ok: within(d) })
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso))
}

export function DateField({
  className,
  value,
  defaultValue,
  onChange,
  onBlur,
  onKeyDown: _onKeyDown,
  min,
  max,
  disabled,
  placeholder,
  autoFocus,
  id,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  ...rest
}: Omit<ComponentProps<'input'>, 'type'>) {
  const native = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(!!autoFocus)
  const [typed, setTyped] = useState('')
  const [typedBad, setTypedBad] = useState(false)
  const [uncontrolled, setUncontrolled] = useState(() => (defaultValue === undefined ? '' : String(defaultValue)))
  const current = value === undefined ? uncontrolled : String(value ?? '')
  const selected = fromIso(current)
  const minD = fromIso(typeof min === 'string' ? min : undefined)
  const maxD = fromIso(typeof max === 'string' ? max : undefined)
  const now = new Date()

  /** Drive the hidden input the way a user would, so React sees a real change. */
  function commit(next: string) {
    setOpen(false)
    if (next === current) {
      fireBlur()
      return
    }
    if (value === undefined) setUncontrolled(next)
    const el = native.current
    if (el) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, next)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    fireBlur()
  }

  function fireBlur() {
    const el = native.current
    if (onBlur && el) onBlur({ target: el, currentTarget: el } as unknown as FocusEvent<HTMLInputElement>)
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setTyped('')
      setTypedBad(false)
      fireBlur()
    }
  }

  function applyTyped() {
    const iso = parseTyped(typed)
    if (!iso) {
      setTypedBad(true)
      return
    }
    if ((minD && iso < toIso(minD)) || (maxD && iso > toIso(maxD))) {
      setTypedBad(true)
      return
    }
    commit(iso)
  }

  const disabledDays = [...(minD ? [{ before: minD }] : []), ...(maxD ? [{ after: maxD }] : [])]
  const quick = quickDates(now, minD, maxD)

  return (
    // `contents`: the wrapper takes no box, so a caller's grid or width
    // classes land on the visible button exactly as they did on the input.
    <div className="contents">
      <input
        ref={native}
        type="date"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        /*
         * hidden, not sr-only.
         *
         * This input is aria-hidden and tabIndex=-1: it is a value carrier and
         * an event source, never something a screen reader or a pointer
         * reaches. sr-only is `position: absolute`, and the wrapper above is
         * `display: contents` -- which generates no box, so it cannot be the
         * containing block. The input was therefore positioned against the
         * PAGE at its static position, and on a tall scrolled screen that
         * point sits below the fold: the document grew by however far down the
         * field was, and the window scrolled past the h-screen shell into a
         * band of empty background. `display: none` still submits with the
         * form, still holds a value and still fires input events.
         */
        className="hidden"
        min={min}
        max={max}
        {...(value === undefined ? { defaultValue } : { value: current })}
        onChange={onChange ?? (() => undefined)}
        {...rest}
      />
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-label={ariaLabel ?? (current ? `Date ${niceDate(current)}` : 'Pick a date')}
            aria-invalid={ariaInvalid}
            className={cn(
              'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-sm transition-colors',
              'hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
              'data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/15',
              className,
            )}
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn('truncate', !current && 'text-muted-foreground')}>
              {current ? niceDate(current) : placeholder || 'Pick a date'}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-3"
          onInteractOutside={(e) => {
            // The month / year dropdowns open a list portalled to the body;
            // a tap there is inside the calendar as far as the person knows.
            if ((e.target as HTMLElement | null)?.closest?.('[role="listbox"]')) e.preventDefault()
          }}
        >
          <form
            className="mb-2 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              applyTyped()
            }}
          >
            <input
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value)
                setTypedBad(false)
              }}
              inputMode="numeric"
              placeholder="Type dd/mm/yyyy"
              aria-label="Type a date"
              aria-invalid={typedBad || undefined}
              className="h-8 w-full rounded-full border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
            />
            {typed && (
              <button type="submit" className="h-8 shrink-0 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">
                Set
              </button>
            )}
          </form>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => commit(q.iso)}
                disabled={!q.ok}
                className={cn(
                  'h-8 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
                  q.iso === current ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-primary/10 hover:text-primary',
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? (minD && minD > now ? minD : now)}
            onSelect={(d) => d && commit(toIso(d))}
            disabled={disabledDays}
            startMonth={minD ?? new Date(now.getFullYear() - 80, 0)}
            endMonth={maxD ?? new Date(now.getFullYear() + 10, 11)}
            autoFocus
          />
          <div className="mt-2 flex items-center border-t border-border pt-2">
            <button
              type="button"
              onClick={() => commit('')}
              disabled={!current}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <X className="size-3.5" aria-hidden /> Clear
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
