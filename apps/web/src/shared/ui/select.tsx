import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from './cn'

/**
 * The dropdown, in the app's own clothes.
 *
 * A native <select> can be styled down to the chevron, but the list it opens
 * is drawn by the operating system: system font, system blue, system
 * scrollbar, square corners in a rounded app. No CSS reaches it. So this
 * renders the trigger as a button and the list as an ordinary menu panel —
 * the same border, card background, radius, shadow and enter animation the
 * account menu uses.
 *
 * It keeps the native element's contract exactly, because ninety-odd call
 * sites already speak it: pass `value` and `onChange`, put <option> elements
 * in as children, read `e.target.value` in the handler. A real <select> stays
 * in the DOM, visually hidden, holding the value and firing the change events
 * — so form submission, `name`, and React's controlled-value behaviour are
 * unchanged, and a caller whose handler ignores the change still snaps back
 * the way a native one does.
 *
 * The list is portalled to the body and positioned against the trigger. Half
 * these dropdowns sit inside the lead drawer, which scrolls — an absolutely
 * positioned panel is clipped by that, and a dropdown you cannot read is
 * worse than an ugly one.
 */

interface Item {
  value: string
  label: ReactNode
  /** Plain text, for typeahead and for the trigger when nothing is selected. */
  text: string
  disabled: boolean
}

interface Box {
  left: number
  top: number
  width: number
  /** Opening upwards, because there is more room above than below. */
  up: boolean
  maxHeight: number
}

/** The visible text of an <option>, for typeahead and the closed trigger. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

function itemsFrom(children: ReactNode): Item[] {
  const out: Item[] = []
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child) || child.type !== 'option') continue
    const props = child.props as ComponentProps<'option'>
    const text = textOf(props.children)
    out.push({
      // An <option> with no value attribute submits its text, as in HTML.
      value: props.value === undefined ? text : String(props.value),
      label: props.children,
      text,
      disabled: props.disabled === true,
    })
  }
  return out
}

const GAP = 4
const MIN_ROOM = 140

export function Select({ className, children, disabled, ...props }: ComponentProps<'select'>) {
  const { value, defaultValue, onChange, id, ...rest } = props
  const items = useMemo(() => itemsFrom(children), [children])
  const native = useRef<HTMLSelectElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<Box | null>(null)
  const listId = useId()

  // Uncontrolled callers still exist; track the value ourselves in that case.
  const [uncontrolled, setUncontrolled] = useState(() => (defaultValue === undefined ? '' : String(defaultValue)))
  const current = value === undefined ? uncontrolled : String(value)
  const selected = items.find((i) => i.value === current)
  const currentRef = useRef(current)
  currentRef.current = current

  /**
   * Drive the hidden <select> the way a user would, so React reports a real
   * change event. The prototype setter side-steps React's value tracking,
   * which would otherwise swallow the event as a no-op.
   */
  function choose(next: string) {
    setOpen(false)
    trigger.current?.focus()
    if (next === current) return
    if (value === undefined) setUncontrolled(next)
    const el = native.current
    if (!el) return
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, next)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const place = useCallback(() => {
    const t = trigger.current?.getBoundingClientRect()
    if (!t) return
    const below = window.innerHeight - t.bottom - GAP * 2
    const above = t.top - GAP * 2
    const up = below < MIN_ROOM && above > below
    const width = Math.min(Math.max(t.width, 180), window.innerWidth - 16)
    setBox({
      left: Math.max(8, Math.min(t.left, window.innerWidth - width - 8)),
      top: up ? t.top - GAP : t.bottom + GAP,
      width: t.width,
      up,
      maxHeight: Math.max(120, Math.min(264, up ? above : below)),
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
    // Any ancestor can scroll (the lead drawer does), so listen in capture.
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return
      setOpen(false)
    }
    /**
     * Escape has to be caught before the dialog behind this one sees it, and
     * a dialog listens on the document during capture — which runs before
     * anything here can bubble. Capture on the window is the one phase that
     * comes earlier, so the dropdown closes and the drawer stays open.
     */
    const onKeyCapture = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKeyCapture, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKeyCapture, true)
    }
  }, [open])

  // Focus the selected row once the list exists, so the keyboard lands where
  // the eye does — and so Escape is caught by the panel rather than reaching
  // the dialog behind it. The panel only mounts after the first measurement,
  // which is why this waits on the box rather than on `open` alone.
  const placed = box !== null
  useEffect(() => {
    if (!open || !placed) return
    const rows = panel.current?.querySelectorAll<HTMLElement>('[role="option"]:not([data-disabled])')
    if (!rows?.length) return
    const at = [...rows].findIndex((r) => r.dataset.value === currentRef.current)
    rows[at >= 0 ? at : 0]?.focus()
  }, [open, placed])

  const typed = useRef({ term: '', at: 0 })

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const rows = [...(panel.current?.querySelectorAll<HTMLElement>('[role="option"]:not([data-disabled])') ?? [])]
    if (e.key === 'Escape' || e.key === 'Tab') {
      // Swallow Escape: a dropdown inside a dialog must close itself and
      // leave the dialog open, and the dialog listens on the document.
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
      setOpen(false)
      trigger.current?.focus()
      return
    }
    if (rows.length === 0) return
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const focusAt = (n: number) => {
      e.preventDefault()
      rows[(n + rows.length) % rows.length]?.focus()
    }
    if (e.key === 'ArrowDown') return focusAt(at + 1)
    if (e.key === 'ArrowUp') return focusAt(at - 1)
    if (e.key === 'Home') return focusAt(0)
    if (e.key === 'End') return focusAt(rows.length - 1)
    // Typeahead: letters jump to the next row starting with what was typed.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now()
      typed.current.term = now - typed.current.at > 900 ? e.key : typed.current.term + e.key
      typed.current.at = now
      const term = typed.current.term.toLowerCase()
      const from = at + (typed.current.term.length > 1 ? 0 : 1)
      const found =
        rows.slice(from).find((r) => (r.dataset.text ?? '').toLowerCase().startsWith(term)) ??
        rows.find((r) => (r.dataset.text ?? '').toLowerCase().startsWith(term))
      if (found) {
        e.preventDefault()
        found.focus()
      }
    }
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      setOpen(true)
    }
  }

  // A Radix Dialog/AlertDialog sets `body { pointer-events: none }` while open
  // and restores its own Content to `auto` — a modal's whole point is that
  // nothing outside that subtree is clickable. This panel is portalled to
  // body, so it inherits `none` and sits there fully visible but inert
  // unless it re-asserts `auto` on itself, regardless of z-index.
  const list = open && box && (
    <div
      ref={panel}
      id={listId}
      role="listbox"
      aria-label={props['aria-label']}
      onKeyDown={onPanelKeyDown}
      style={{
        left: box.left,
        // Match the trigger, but let a long label push wider rather than
        // truncate — a native list sizes to its content and so should this.
        minWidth: Math.max(box.width, 180),
        maxWidth: Math.max(box.width, window.innerWidth - box.left - 8),
        maxHeight: box.maxHeight,
        ...(box.up ? { bottom: window.innerHeight - box.top } : { top: box.top }),
      }}
      className="ipc-menu pointer-events-auto fixed z-[60] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-card p-1.5 shadow-lg"
    >
      {items.length === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">Nothing to choose from</p>}
      {items.map((item, i) => {
        const isSelected = item.value === current
        return (
          <button
            // Values repeat across a list often enough (two blanks, say) to
            // need the index as well.
            key={`${item.value}-${i}`}
            type="button"
            role="option"
            aria-selected={isSelected}
            data-value={item.value}
            data-text={item.text}
            {...(item.disabled ? { 'data-disabled': '' } : {})}
            disabled={item.disabled}
            onClick={() => choose(item.value)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-base transition-colors',
              'focus-visible:outline-none',
              item.disabled ? 'cursor-not-allowed text-muted-foreground opacity-60' : 'hover:bg-muted focus:bg-muted',
              isSelected && 'font-medium',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {isSelected && <Check className="size-3.5 shrink-0 text-brand" aria-hidden />}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className={cn('relative', className)}>
      {/* The real control: holds the value, fires the events, posts with a form. */}
      <select
        ref={native}
        id={id}
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        /* hidden, not sr-only: see date-field.tsx. aria-hidden + tabIndex=-1
         * means no screen reader or pointer reaches this; sr-only would make
         * it `position: absolute` inside a `display: contents` wrapper, which
         * is no containing block, so it anchors to the PAGE and grows the
         * document by however far down the field sits. */
        className="hidden"
        {...(value === undefined ? { defaultValue } : { value })}
        onChange={onChange}
        {...rest}
      >
        {/* A blank keeps the element valid when the value matches no option. */}
        {!selected && <option value={current} />}
        {children}
      </select>

      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={props['aria-invalid']}
        aria-label={props['aria-label']}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card py-1 pl-3 pr-2.5 text-left text-base shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
          !disabled && 'hover:border-ring/40',
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : (items.find((i) => i.value === '')?.label ?? '')}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {list && createPortal(list, document.body)}
    </div>
  )
}


