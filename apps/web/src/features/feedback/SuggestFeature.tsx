import { lazy, Suspense, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { cn } from '@/shared/ui/cn'

const SuggestFeatureDialog = lazy(() => import('./SuggestFeatureDialog').then((m) => ({ default: m.SuggestFeatureDialog })))

/**
 * "Suggest a feature · सुझाव दें" -- on every screen, in both languages, small
 * enough not to pull the eye from the work but always there. Anyone can say
 * what would help, by typing, by a voice note, or by showing the screen; it
 * goes straight to the people who build the app.
 */
/** The dialog alone, for a menu that closes before the dialog opens (the account menu on a phone). */
export function SuggestFeatureDialogLazy({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <SuggestFeatureDialog open={open} onOpenChange={onOpenChange} />
    </Suspense>
  )
}

export function SuggestFeatureButton({ variant = 'header', className }: { variant?: 'header' | 'menu'; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {variant === 'menu' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 rounded-lg border border-tone-amber/30 bg-tone-amber-soft px-3 py-2 text-left"
        >
          <Lightbulb className="size-4 shrink-0 text-tone-amber" aria-hidden />
          <span className="leading-tight">
            <span className="block text-sm font-semibold">Suggest a feature</span>
            <span className="block text-xs text-muted-foreground">सुझाव दें</span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Suggest a feature · सुझाव दें"
          title="Suggest a feature · सुझाव दें"
          // One line with room around it: the two-line pill was cramped
          // against its own border.
          className={cn('inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-tone-amber/40 bg-tone-amber-soft px-3 text-xs font-semibold text-foreground transition-colors hover:border-tone-amber', className)}
        >
          <Lightbulb className="size-4 shrink-0 text-tone-amber" aria-hidden />
          {/* Named from 1360px, like the shortcut pills, so it reads as an invitation. */}
          <span className="hidden min-[1360px]:inline min-[1800px]:hidden">Suggest an idea</span>
          <span className="hidden min-[1800px]:inline">Suggest a feature</span>
          <span className="hidden text-muted-foreground min-[1800px]:inline" aria-hidden>
            ·
          </span>
          <span className="hidden font-medium leading-normal min-[1800px]:inline">सुझाव दें</span>
        </button>
      )}
      {/* The dialog (voice notes, screenshots) loads on the first press, not
          with every page (speed audit, 11 Nov). */}
      {open && (
        <Suspense fallback={null}>
          <SuggestFeatureDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  )
}
