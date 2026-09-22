import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from './cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title?: string; description?: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ipc-overlay fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          /*
           * max-h + overflow are not a nicety — without them a tall dialog is
           * unusable.
           *
           * The box is centred with `top-1/2 -translate-y-1/2` and had no
           * height limit, so a form taller than the viewport grew off BOTH
           * edges and its Cancel/Save row ended up below the bottom of the
           * screen with no way to scroll to it. The New Invoice form (~28
           * controls) hit this exactly, and it was reported as "I can't see
           * the buttons".
           *
           * dvh rather than vh: on a phone `100vh` is the height with the
           * browser chrome retracted, which is taller than what you can
           * actually see — precisely how a footer hides under the address bar.
           *
           * A dialog passing its own max-h still wins, so the 15 screens that
           * had already worked around this are unaffected.
           */
          'ipc-dialog fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-lg',
          className,
        )}
        {...props}
      >
        {title && (
          <div className="mb-4">
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
        )}
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" aria-hidden />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mb-4 space-y-1', className)} {...props} />
}
export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />
}
export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
}
/**
 * The action row, pinned to the bottom of a scrolling dialog.
 *
 * `sticky` inside the scroll container keeps Save and Cancel on screen while a
 * long form scrolls behind them, so nobody has to scroll to the end to find
 * out what their options are. The negative margin plus matching padding lets
 * the bar span the dialog's full width despite the content's own padding.
 */
export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'sticky bottom-0 -mx-4 -mb-4 mt-6 flex justify-end gap-2 border-t border-border bg-card px-4 py-3',
        className,
      )}
      {...props}
    />
  )
}
