import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, CheckCircle2, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'

/**
 * The setup journey's thread through the rest of the app.
 *
 * Every step on the journey links out with `?from=setup`. That one marker is
 * what lets a page reached from setup behave like a step of it: say so at the
 * top, and, once its job is done, hand the owner back to the journey — which
 * by then shows the next step as current — instead of leaving them on a list
 * page wondering what to do now.
 */
export const SETUP_SEARCH = { from: 'setup' } as const

/** Whether this page was opened from the setup journey. Reactive to navigation. */
export function useFromSetup(): boolean {
  const { search } = useLocation()
  return (search as Record<string, unknown>).from === 'setup'
}

/** Back to the journey, which now points at whatever is next. */
export function useBackToSetup() {
  const navigate = useNavigate()
  return () => void navigate({ to: '/dashboard' })
}

/**
 * The strip across the top of a page opened from the setup journey.
 *
 * Without it, a step's destination looked like any other page of the app and
 * the way back to "what do I do next" was the sidebar — the thing setup is
 * meant to spare a new studio from learning first.
 */
export function SetupReturnBar() {
  const fromSetup = useFromSetup()
  if (!fromSetup) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
      <Sparkles className="size-4 text-primary" aria-hidden />
      <span className="font-medium text-primary">Setting up your studio</span>
      <span className="text-muted-foreground">— finish this step, and we&apos;ll take you to the next one.</span>
      <Link
        to="/dashboard"
        className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Setup steps
      </Link>
    </div>
  )
}

/**
 * "Done — add another?" after the first of something is saved.
 *
 * Asked the moment a step's work is done rather than left for the owner to
 * work out: yes goes straight back into adding, no moves them on. When the
 * page came from setup, "no" means the next setup step; otherwise it simply
 * closes.
 */
export function AddMorePrompt({
  open,
  title,
  description,
  moreLabel,
  onMore,
  onDone,
  fromSetup,
}: {
  open: boolean
  title: string
  description: string
  moreLabel: string
  onMore: () => void
  onDone: () => void
  fromSetup: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="max-w-md">
        <div className="flex flex-col items-center gap-2 pt-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <Button className="flex-1" onClick={onMore}>
            <Plus /> {moreLabel}
          </Button>
          <Button variant="outline" className="flex-1" onClick={onDone}>
            {fromSetup ? (
              <>
                No, next setup step <ArrowRight />
              </>
            ) : (
              "No, I'm done"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
