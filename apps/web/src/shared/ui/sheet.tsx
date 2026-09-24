import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from './cn'

/**
 * A panel that slides in from the right: the whole of one thing, without
 * leaving the page it was opened from. Full width on a phone.
 *
 * Built on the same Radix dialog as `Dialog`, so focus, Escape and the
 * overlay behave the same; only the shape differs.
 */
export const Sheet = DialogPrimitive.Root

export function SheetContent({
  className,
  children,
  title,
  description,
  onOpenAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ipc-overlay fixed inset-0 z-50 bg-black/30" />
      <DialogPrimitive.Content
        className={cn(
          'ipc-sheet fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col border-l border-border bg-background shadow-2xl outline-none sm:max-w-xl',
          className,
        )}
        // Land on the panel, not its first field: opening to read should not
        // light up a picker. Tab still walks in from the top.
        onOpenAutoFocus={(e) => {
          onOpenAutoFocus?.(e)
          if (e.defaultPrevented) return
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
        tabIndex={-1}
        {...props}
      >
        {/* The visible header is the caller's; these keep screen readers told. */}
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" aria-hidden />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
