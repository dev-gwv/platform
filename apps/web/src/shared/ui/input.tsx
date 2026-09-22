import type { ComponentProps } from 'react'
import { cn } from './cn'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-base shadow-sm transition-colors',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Invalid state rides on aria-invalid, so the colour and the thing a
        // screen reader announces can never disagree.
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The multi-line twin of Input. Screens that needed one were each pasting the
 * same border/padding string onto a bare <textarea>, so they had already
 * drifted — no focus ring on some, a different background on others.
 */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-sm transition-colors',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  )
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium', className)} {...props} />
}

// The dropdown outgrew a styled <select>: the list a native one opens is drawn
// by the OS and no CSS reaches it. It lives in ./select now and is re-exported
// here so every existing `import { Input, Label, Select }` keeps working.
export { Select } from './select'
