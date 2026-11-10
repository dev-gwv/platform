import { Link } from '@tanstack/react-router'
import { PlayCircle } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { SETUP_VIDEOS } from './setup-videos'

/**
 * "New here? Watch how to set up — 6 short videos" under the sign-in and
 * sign-up form and on the home page, so nobody meets the app cold (owner,
 * 10 Nov). Opens /start, the setup videos in English or Hindi.
 */
export function SetupVideosLink({ className, card = false, onNavigate }: { className?: string; card?: boolean; onNavigate?: () => void }) {
  const n = SETUP_VIDEOS.length
  if (card)
    return (
      <Link
        to="/start"
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-3 rounded-xl border border-teal-500/40 bg-teal-500/5 p-3.5 text-left transition-colors hover:bg-teal-500/10',
          className,
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white">
          <PlayCircle className="size-5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">Set up your studio, step by step</span>
          <span className="block text-sm text-muted-foreground">{n} short videos · English · हिन्दी</span>
        </span>
      </Link>
    )
  return (
    <div className={cn('flex flex-col items-center gap-1.5 text-sm', className)}>
      <span className="text-muted-foreground">New here? See every step before you start.</span>
      <Link
        to="/start"
        className="inline-flex items-center gap-2 rounded-full border border-teal-600/40 bg-teal-50 px-4 py-2 font-semibold text-teal-800 shadow-sm transition-colors hover:bg-teal-100 dark:bg-teal-950/40 dark:text-teal-300"
      >
        <PlayCircle className="size-4" aria-hidden />
        Watch how to set up · {n} short videos
        <span className="font-normal text-teal-700/80 dark:text-teal-400/80">English · हिन्दी</span>
      </Link>
    </div>
  )
}
