import { useRef, useState, type ComponentProps, type FocusEvent } from 'react'
import { Clock, X } from 'lucide-react'
import { cn } from './cn'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import {
  MINUTE_STEPS,
  QUICK_TIMES,
  defaultPeriod,
  from12h,
  niceTime,
  parseTime,
  parseTypedTime,
  to12h,
  toHHMM,
  type Period,
} from './time-format'

/**
 * The time box, in the app's own clothes — the twin of DateField.
 *
 * A native time input opens whatever the browser draws: three grey spinner
 * columns in system font. This shows the time the way a person says it
 * ("3:12 PM") and opens our own picker under it: the call times a studio
 * actually uses as one-tap chips, then big hour and minute buttons for
 * anything else, and a box to type "3.15pm" for anyone quicker on the keys.
 *
 * It keeps the native element's contract, because every form that picks a
 * time already speaks it: `value` / `defaultValue` as "HH:MM", `onChange`
 * reading `e.target.value`, `name`, `required`. A real <input type="time">
 * stays in the DOM, visually hidden, holding the value and firing the events.
 */
export function TimeField({
  className,
  value,
  defaultValue,
  onChange,
  onBlur,
  onKeyDown: _onKeyDown,
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
  const clock = parseTime(current)
  const view = clock ? to12h(clock) : null

  /** Drive the hidden input the way a user would, so React sees a real change. */
  function commit(next: string, close = true) {
    if (close) setOpen(false)
    if (next !== current) {
      if (value === undefined) setUncontrolled(next)
      const el = native.current
      if (el) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, next)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
    if (close) fireBlur()
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
    const hhmm = parseTypedTime(typed)
    if (!hhmm) {
      setTypedBad(true)
      return
    }
    commit(hhmm)
  }

  // Picking an hour, a minute or a half of the day keeps the popover open:
  // most people set two of the three, and closing after the first would make
  // them reopen it every time.
  const pickHour = (hour12: number) =>
    commit(toHHMM(from12h(hour12, view?.minute ?? 0, view?.period ?? defaultPeriod(hour12))), false)
  const pickMinute = (minute: number) => view && commit(toHHMM(from12h(view.hour12, minute, view.period)), false)
  const pickPeriod = (period: Period) => view && commit(toHHMM(from12h(view.hour12, view.minute, period)), false)

  const chip = (selected: boolean) =>
    cn(
      'h-8 rounded-full text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      selected ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-primary/10 hover:text-primary',
    )
  const cell = (selected: boolean) =>
    cn(
      'flex size-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors',
      'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 disabled:hover:bg-transparent',
      selected && 'bg-primary font-semibold text-primary-foreground hover:bg-primary',
    )
  const label = (text: string) => (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{text}</p>
  )

  return (
    // `contents`: the wrapper takes no box, so a caller's grid or width
    // classes land on the visible button exactly as they did on the input.
    <div className="contents">
      <input
        ref={native}
        type="time"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        className="sr-only"
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
            aria-label={ariaLabel ?? (current ? `Time ${niceTime(current)}` : 'Pick a time')}
            aria-invalid={ariaInvalid}
            className={cn(
              'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-sm transition-colors',
              'hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
              'data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/15',
              className,
            )}
          >
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn('truncate', !current && 'text-muted-foreground')}>
              {current ? niceTime(current) : placeholder || 'Pick a time'}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[19rem] max-w-[calc(100vw-1rem)] p-3">
          <form
            className="mb-3 flex items-center gap-1.5"
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
              autoFocus
              placeholder="Type a time, e.g. 3:15 pm"
              aria-label="Type a time"
              aria-invalid={typedBad || undefined}
              className="h-8 w-full rounded-full border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
            />
            {typed && (
              <button type="submit" className="h-8 shrink-0 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">
                Set
              </button>
            )}
          </form>

          {label('Common call times')}
          <div className="mb-3 grid grid-cols-4 gap-1.5">
            {QUICK_TIMES.map((t) => (
              <button key={t} type="button" onClick={() => commit(t)} className={chip(t === current)}>
                {niceTime(t)}
              </button>
            ))}
          </div>

          <div className="mb-3 grid grid-cols-2 rounded-lg bg-muted p-1" role="group" aria-label="Morning or afternoon">
            {(['AM', 'PM'] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={!view}
                aria-pressed={view?.period === p}
                onClick={() => pickPeriod(p)}
                className={cn(
                  'h-8 rounded-md text-sm font-semibold transition-colors disabled:opacity-40',
                  view?.period === p ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p}
              </button>
            ))}
          </div>

          {label('Hour')}
          <div className="mb-3 grid grid-cols-6 gap-1">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <button key={h} type="button" onClick={() => pickHour(h)} className={cell(view?.hour12 === h)}>
                {h}
              </button>
            ))}
          </div>

          {label('Minute')}
          <div className="grid grid-cols-6 gap-1">
            {MINUTE_STEPS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={!view}
                onClick={() => pickMinute(m)}
                className={cell(view?.minute === m)}
              >
                {String(m).padStart(2, '0')}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
            <button
              type="button"
              onClick={() => commit('')}
              disabled={!current}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <X className="size-3.5" aria-hidden /> Clear
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
            >
              Done
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
