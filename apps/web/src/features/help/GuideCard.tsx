import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { GraduationCap, X } from 'lucide-react'
import { useHints, useSetHint } from '@/features/team/hints-api'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'

/** Shown on this many visits at most, then only Help keeps the way in. */
export const GUIDE_CARD_VISITS = 8

let countedThisLoad = false

/**
 * "Learn Studio AutoPilot step by step" on everyone's Home -- the owner's and
 * each team member's -- until they open the guide, close it, or have seen it
 * on eight visits. After that the guide is still the first line in Help.
 */
export function GuideCard({ className }: { className?: string }) {
  const hints = useHints()
  const setHint = useSetHint()
  const note = hints.data?.guide
  const show = hints.isSuccess && !note?.closed && (note?.shown ?? 0) < GUIDE_CARD_VISITS

  useEffect(() => {
    if (!show || countedThisLoad) return
    countedThisLoad = true
    setHint.mutate({ key: 'guide', value: { shown: (note?.shown ?? 0) + 1, closed: false } })
  }, [show])

  if (!show) return null
  return (
    <div className={cn('mt-4 flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 sm:p-4', className)} data-testid="guide-card">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <GraduationCap className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Learn Studio AutoPilot step by step</p>
        <p className="text-sm text-muted-foreground">Short videos for every job · English · हिन्दी</p>
      </div>
      <Button asChild size="sm">
        <Link to="/learn">Start</Link>
      </Button>
      <button
        type="button"
        onClick={() => setHint.mutate({ key: 'guide', value: { shown: note?.shown ?? 1, closed: true } })}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Close"
        title="Close. The guide stays in Help."
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
