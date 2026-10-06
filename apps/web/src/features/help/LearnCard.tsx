import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlayCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import { learnSignals, type LearnNote } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { cn } from '@/shared/ui/cn'
import { useHints, useSetHint } from '@/features/team/hints-api'
import { useTutorials } from './api'
import { isRetired, remember } from './learning'
import { startStuck, stuckReason, stuckStep, type StuckEvent, type StuckState } from './stuck-rules'
import { TutorialPlayer } from './TutorialPlayer'
import { useHelpLang } from './lang'
import { lengthLabel, posterSrc, titleIn, type Tutorial } from './tutorials'

/** How many of each thing the studio has, for the cards to step back on. */
export function useLearnSignals() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['me', 'learn'],
    queryFn: () => callApi('/auth/learn', { responseSchema: learnSignals }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

/**
 * What a person did on a screen this visit, per video: kept outside React so
 * closing and opening a dialog again counts as the second try.
 */
const visit = new Map<string, StuckState>()

export interface Learn {
  /** The card to put at the top of the screen, or null once they know the job. */
  card: React.ReactNode
  /** Save or Next was refused (a field missing). */
  refused: () => void
  /** They moved forward: saved, or went to the next step. */
  progress: () => void
}

/**
 * The how-to video for one job, where the job is done: a slim card at the top
 * ("New to this? Watch how to add your team · 37 s"), and -- if the person
 * seems stuck -- an offer of the same video in the corner. Both step back for
 * good once the person has learnt the job (see learning.ts).
 *
 * `countClose`: the screen is a dialog, so closing it without saving is a
 * try that did not work out. Not for wizard steps, which unmount on Next.
 */
export function useLearn(key: string, { countClose = false }: { countClose?: boolean } = {}): Learn {
  const tutorials = useTutorials()
  const tutorial = useMemo(() => tutorials.find((t) => t.key === key) ?? null, [tutorials, key])
  const signals = useLearnSignals()
  const hints = useHints()
  const setHint = useSetHint()
  const note = hints.data?.learn as LearnNote | undefined
  const [playing, setPlaying] = useState<Tutorial | null>(null)
  const [hidden, setHidden] = useState(false)

  const ready = signals.isSuccess && hints.isSuccess && !!tutorial
  const show = ready && !hidden && !isRetired(key, signals.data, note)

  const save = useCallback(
    (list: 'watched' | 'closed') => setHint.mutate({ key: 'learn', value: remember(hints.data?.learn as LearnNote | undefined, list, key) }),
    [hints.data, key, setHint],
  )

  // ── stuck? ──
  const moved = useRef(false)
  const feed = useCallback(
    (e: StuckEvent) => {
      const s = stuckStep(visit.get(key) ?? startStuck(Date.now()), e)
      visit.set(key, s)
      return s
    },
    [key],
  )
  const offer = useCallback(() => {
    if (!tutorial) return
    const s = visit.get(key)
    if (!s || !stuckReason(s, Date.now())) return
    feed({ type: 'offered' })
    toast(`Stuck? Watch how${tutorial.seconds ? ` · ${lengthLabel(tutorial.seconds)}` : ''}`, {
      id: `stuck-${key}`,
      description: tutorial.title,
      duration: 20_000,
      action: { label: 'Watch', onClick: () => setPlaying(tutorial) },
    })
  }, [feed, key, tutorial])

  // The listeners live as long as the screen does; they read the latest
  // feed/offer through refs, so a re-render never counts as closing it.
  const feedRef = useRef(feed)
  const offerRef = useRef(offer)
  feedRef.current = feed
  offerRef.current = offer
  useEffect(() => {
    if (!show) return
    // Arriving is activity; a visit that was already offered stays offered.
    feedRef.current({ type: 'activity', at: Date.now() })
    moved.current = false
    // A dialog closed twice without saving: offer the video as it opens again.
    if (countClose) offerRef.current()
    const touch = () => feedRef.current({ type: 'activity', at: Date.now() })
    document.addEventListener('input', touch, true)
    document.addEventListener('pointerdown', touch, true)
    const tick = window.setInterval(() => offerRef.current(), 5_000)
    return () => {
      document.removeEventListener('input', touch, true)
      document.removeEventListener('pointerdown', touch, true)
      window.clearInterval(tick)
      if (countClose && !moved.current) feedRef.current({ type: 'dismissed', at: Date.now() })
    }
  }, [show, countClose, key])

  const refused = useCallback(() => {
    if (!show) return
    feed({ type: 'refused', at: Date.now() })
    offer()
  }, [show, feed, offer])
  const progress = useCallback(() => {
    moved.current = true
    feed({ type: 'progress', at: Date.now() })
  }, [feed])

  const player = (
    <TutorialPlayer
      tutorial={playing}
      onClose={() => setPlaying(null)}
      onWatched={(k) => {
        if (k === key) save('watched')
      }}
    />
  )

  const card =
    show && tutorial ? (
      <>
        <LearnCardView
          tutorial={tutorial}
          onPlay={() => setPlaying(tutorial)}
          onClose={() => {
            setHidden(true)
            save('closed')
          }}
        />
        {player}
      </>
    ) : playing ? (
      player
    ) : null

  return { card, refused, progress }
}

/** The card itself: the video's first frame, one line, and a quiet close. */
export function LearnCardView({ tutorial, onPlay, onClose, className }: { tutorial: Tutorial; onPlay: () => void; onClose: () => void; className?: string }) {
  const [lang] = useHelpLang()
  const poster = posterSrc(tutorial, lang)
  return (
    <div className={cn('flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-2 pr-1', className)} data-testid="learn-card">
      <button
        type="button"
        onClick={onPlay}
        className="group relative aspect-video w-24 shrink-0 overflow-hidden rounded-md border border-border bg-muted"
        aria-label={`Play: ${titleIn(tutorial, lang)}`}
      >
        {poster && <img src={poster} alt="" className="size-full object-cover" loading="lazy" />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/35">
          <PlayCircle className="size-7 text-white drop-shadow" aria-hidden />
        </span>
      </button>
      <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold text-primary">New to this? Watch how</span>
        <span className="block truncate text-xs text-muted-foreground">
          {titleIn(tutorial, lang)}
          {tutorial.seconds ? ` · ${lengthLabel(tutorial.seconds)}` : ''}
        </span>
      </button>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Don't show this again"
        title="Don't show this again"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
