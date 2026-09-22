import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis } from 'lucide-react'
import { Button } from './button'
import { cn } from './cn'

export interface RowMenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
}

/**
 * The "⋯" on a table row: the actions a row supports but that nobody needs
 * on every row at once.
 *
 * A row showing all five of its actions as buttons made the actions column
 * wide enough to push the rest of the table off-screen; two named buttons
 * and this menu keep the common case in sight and the rest one click away.
 *
 * The list is portalled and fixed-positioned, like the Select dropdown, so a
 * table's scroll box cannot clip it. It closes on a choice, an outside click,
 * Escape, or any scroll — a menu left floating over a list that has moved
 * out from under it would point at the wrong row.
 */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [box, setBox] = useState<{ top: number; right: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const open = box !== null

  const close = (refocus = true) => {
    setBox(null)
    if (refocus) trigger.current?.focus()
  }

  const toggle = () => {
    if (open) return close()
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    setBox({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    const onMove = () => close(false)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  return (
    <>
      <Button
        ref={trigger}
        size="sm"
        variant="ghost"
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        <Ellipsis />
        <span className="sr-only">{label}</span>
      </Button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={menuId}
            role="menu"
            style={{ position: 'fixed', top: box.top, right: box.right }}
            className="z-50 min-w-48 rounded-lg border border-border bg-card p-1 text-sm shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close()
                  item.onSelect()
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                  'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
