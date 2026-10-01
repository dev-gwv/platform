import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cn } from './cn'

/**
 * A card that opens when the mouse rests on its trigger, and on a tap where
 * there is no mouse -- for detail that helps but is not needed every time
 * (who else a photographer is booked with that day).
 *
 * It is a Radix popover, not a custom portal: those cannot be clicked inside
 * a dialog, and these sit inside Assign team. Moving from the trigger onto
 * the card keeps it open.
 */
export function HoverPopover({
  children,
  content,
  className,
  side = 'bottom',
  align = 'start',
}: {
  /** One element that can hold a ref and take pointer events: a button, usually. */
  children: ReactElement
  content: ReactNode
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const later = (next: boolean, ms: number) => {
    clear()
    timer.current = setTimeout(() => {
      timer.current = null
      setOpen(next)
    }, ms)
  }
  useEffect(() => clear, [])

  // Opening waits for the mouse to actually move over the trigger. A list
  // that appears under a resting pointer (the picker opening below the
  // button just clicked) must not pop a card over the rest of the dialog.
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || open || timer.current) return
    later(true, 200)
  }
  const onLeave = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    if (open) later(false, 120)
    else clear()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onPointerMove={onMove} onPointerLeave={onLeave}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className={cn('w-72 p-3', className)}
        onPointerEnter={(e) => e.pointerType === 'mouse' && clear()}
        onPointerLeave={onLeave}
        // Opened by hovering, the card must not take focus away from the list.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}
