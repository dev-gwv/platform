import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Play, PlayCircle, X } from 'lucide-react'
import { gettingStarted } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { useHints, useSetHint } from '@/features/team/hints-api'
import { useTutorials } from '@/features/help/api'
import { useHelpLang } from '@/features/help/lang'
import { LangSwitch, TutorialPlayer } from '@/features/help/TutorialPlayer'
import { lengthLabel, type Tutorial } from '@/features/help/tutorials'
import { BookCallButton, useCallUrl } from '@/features/help/BookCall'
import type { StudioSignals } from './journey'
import { nextSetupStep, setupCountLine, setupProgress, setupStepTarget, showSetupProgress } from './setup-progress'

function useStart() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['settings', 'getting-started'],
    queryFn: () => callApi('/settings/getting-started', { responseSchema: gettingStarted }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

/**
 * Whether the card is up, so Home shows one onboarding card at a time; null
 * while it is still being worked out, so nothing else flashes in its place.
 */
export function useSetupVideosShowing(signals: StudioSignals | null): boolean | null {
  const q = useStart()
  const hints = useHints()
  if (!signals) return false
  if (q.isPending || hints.isPending) return null
  if (!q.data || !hints.isSuccess) return false
  return showSetupProgress(setupProgress({ ...signals, ...q.data }), q.data.started_at, !!hints.data.setup_videos?.closed)
}

/**
 * "Set up Studio AutoPilot, step by step": the six setup videos as one card on
 * a new studio's Home. Each step ticks itself from the studio's data; the next
 * one is amber with **Watch** (the video plays right here) and **Do this
 * now** (the screen where it is done). All six, written out, are on /start.
 */
export function SetupVideosCard({ signals }: { signals: StudioSignals }) {
  const { session } = useAuth()
  const q = useStart()
  const hints = useHints()
  const setHint = useSetHint()
  const tutorials = useTutorials()
  const callUrl = useCallUrl()
  const [lang, setLang] = useHelpLang()
  const [playing, setPlaying] = useState<Tutorial | null>(null)
  if (!q.data || !hints.isSuccess) return null
  const steps = setupProgress({ ...signals, ...q.data })
  if (!showSetupProgress(steps, q.data.started_at, !!hints.data.setup_videos?.closed)) return null

  const next = nextSetupStep(steps)
  const done = steps.filter((s) => s.done).length
  const setupOpen = !!session && !session.setup_done
  const videoOf = (key: string) => tutorials.find((t) => t.key === key) ?? null

  return (
    <Card className="mt-4 border-primary/40" data-testid="setup-videos-card">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <PlayCircle className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{lang === 'hi' ? 'Studio AutoPilot सेट करें, स्टेप बाय स्टेप' : 'Set up Studio AutoPilot, step by step'}</p>
              <p className="text-xs text-muted-foreground">
                {setupCountLine(steps)} · {lang === 'hi' ? 'हर वीडियो एक मिनट से कम' : 'each video under a minute'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <LangSwitch lang={lang} onChange={setLang} className="hidden sm:inline-flex" />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close the setup videos"
              title="Close. The setup videos stay in Help."
              onClick={() => setHint.mutate({ key: 'setup_videos', value: { shown: 1, closed: true } })}
            >
              <X />
            </Button>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ol className="mt-3 flex flex-col gap-1.5">
          {steps.map((s) => {
            const isNext = s === next
            const video = videoOf(s.step.video)
            const target = setupStepTarget(s.step, setupOpen)
            return (
              <li
                key={s.step.key}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm',
                  s.done && 'border-success/30 bg-success/10 text-muted-foreground',
                  isNext && 'border-dashed border-tone-amber bg-tone-amber-soft',
                  !s.done && !isNext && 'border-border',
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                      s.done ? 'border-success bg-success text-success-foreground' : 'border-input bg-card',
                    )}
                  >
                    {s.done ? <Check className="size-3.5" aria-hidden /> : s.n}
                  </span>
                  <span className={cn('min-w-0 flex-1', s.done && 'line-through', isNext && 'font-semibold text-foreground')}>
                    {s.step.title[lang]}
                    {s.step.optional && <span className="ml-1 text-xs font-normal text-muted-foreground">({lang === 'hi' ? 'वैकल्पिक' : 'optional'})</span>}
                  </span>
                  {!isNext && video && (
                    <button
                      type="button"
                      onClick={() => setPlaying(video)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
                      aria-label={`Watch: ${s.step.title.en}`}
                    >
                      <Play className="size-3" aria-hidden /> {lang === 'hi' ? 'देखें' : 'Watch'}
                    </button>
                  )}
                </div>
                {isNext && (
                  <div className="mt-2 pl-9">
                    <p className="text-muted-foreground">{s.step.why[lang]}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {video && (
                        <Button size="sm" onClick={() => setPlaying(video)}>
                          <Play /> {lang === 'hi' ? 'वीडियो देखें' : 'Watch'}
                          {video.seconds > 0 && ` · ${lengthLabel(video.seconds)}`}
                        </Button>
                      )}
                      <Button asChild size="sm" variant="outline">
                        <Link to={target.to} search={target.search as never}>
                          {lang === 'hi' ? 'अभी करें' : 'Do this now'} <ArrowRight />
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
          <Link to="/start" className="font-medium text-primary underline-offset-2 hover:underline">
            {lang === 'hi' ? 'हर स्टेप लिखा हुआ देखें' : 'Every step, written out'}
          </Link>
          {callUrl && <BookCallButton size="sm" label="Book a 15-minute support call" />}
        </div>
      </CardContent>
      <TutorialPlayer tutorial={playing} onClose={() => setPlaying(null)} />
    </Card>
  )
}
