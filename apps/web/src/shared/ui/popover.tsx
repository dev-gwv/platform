import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useMemo, type ComponentProps } from 'react'
import { cn } from './cn'
import { scrollInsideRef } from './scroll-inside'

/**
 * A small panel anchored to its trigger: the calendar under a date field, and
 * anything else that should float next to what opened it. Radix handles focus,
 * Escape, outside clicks and staying on screen.
 */
export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({ className, align = 'start', sideOffset = 6, ref, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  // Portalled outside any dialog it opens from, so a dialog's scroll lock
  // would otherwise swallow every swipe on its list (scroll-inside.ts).
  const own = useMemo(() => scrollInsideRef(ref), [ref])
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={own}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'ipc-menu z-[55] rounded-xl border border-border bg-card p-3 text-card-foreground shadow-xl outline-none overscroll-contain [&_*]:overscroll-contain',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
