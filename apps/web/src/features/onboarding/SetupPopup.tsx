import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Play } from 'lucide-react'
import { gettingStarted, learnSignals } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { cn } from '@/shared/ui/cn'
import { useTutorials } from '@/features/help/api'
import { useHelpLang } from '@/features/help/lang'
import { LangSwitch } from '@/features/help/TutorialPlayer'
import { lengthLabel, playsIn, posterSrc, videoSrc } from '@/features/help/tutorials'
import { isSetupAudience } from './journey'
import { POPUP_GAP_HOURS, nextSetupStep, popupDue, setupCountLine, setupProgress, setupStepTarget } from './setup-progress'

/** Pages it never opens over: the videos themselves, a step being done, full-screen tools. */
const NOT_ON = ['/start', '/help', '/learn', '/login', '/projects/new', '/platform', '/ai/designer/']

const keyFor = (uid: string) => `setup-popup:${uid}`
function readQuiet(uid: string): number | null {
  try {
    const v = Number(window.localStorage.getItem(keyFor(uid)))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
function quietFor(uid: string, hours: number) {
  try {
    window.localStorage.setItem(keyFor(uid), String(Date.now() + hours * 3_600_000))
  } catch {
    // Storage blocked: it may come back on the next page load, nothing worse.
  }
}

let openedThisLoad = false

/**
 * "Set up your Studio AutoPilot" (owner, 14 Nov): a pop-up that keeps coming
 * back for a new studio's owner or admin until they start using the app --
 * every visit while there is no project yet, and again after three quiet days
 * while setup is unfinished (`popupDue`). It plays the next step's video in
 * English or हिन्दी, lists all six steps ticked from the studio's own data, and
 * sends them to do the step. "Later" puts it away for 4 hours, "Tomorrow" for
 * a day. Once a visit at most, never over another dialog.
 */
export function SetupPopup() {
  const { session } = useAuth()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const tutorials = useTutorials()
  const [lang, setLang] = useHelpLang()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const audience = !!session && isSetupAudience(session)
  const signals = useQuery({
    queryKey: ['me', 'learn'],
    queryFn: () => callApi('/auth/learn', { responseSchema: learnSignals }),
    enabled: audience,
    staleTime: 60_000,
  })
  const start = useQuery({
    queryKey: ['settings', 'getting-started'],
    queryFn: () => callApi('/settings/getting-started', { responseSchema: gettingStarted }),
    enabled: audience,
    staleTime: 30_000,
  })
  const steps = useMemo(
    () => (signals.data && start.data ? setupProgress({ ...signals.data, ...start.data }) : null),
    [signals.data, start.data],
  )
  const uid = session?.user_id ?? ''
  const fromSetup = (search as Record<string, unknown>).from === 'setup'
  const blocked = NOT_ON.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`)) || fromSetup
  const due =
    !!steps &&
    !!start.data &&
    !!signals.data &&
    popupDue({
      steps,
      projects: signals.data.projects,
      lastWorkAt: start.data.last_work_at,
      startedAt: start.data.started_at,
      quietUntil: readQuiet(uid),
    })

  useEffect(() => {
    if (!due || blocked || openedThisLoad || !uid) return
    // A moment after the page settles, and never over a dialog already open.
    const t = setTimeout(() => {
      if (document.querySelector('[role="dialog"]')) return
      openedThisLoad = true
      setOpen(true)
    }, 2500)
    return () => clearTimeout(t)
  }, [due, blocked, uid])

  if (!steps || !open) return null
  const next = nextSetupStep(steps)
  const shown = steps.find((s) => s.step.key === picked) ?? next ?? steps[0]!
  const video = tutorials.find((t) => t.key === shown.step.video) ?? null
  const target = setupStepTarget(shown.step, !session?.setup_done)
  const away = (hours: number) => {
    quietFor(uid, hours)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && away(POPUP_GAP_HOURS)}>
      <DialogContent
        title={lang === 'hi' ? 'अपना Studio AutoPilot सेट करें' : 'Set up your Studio AutoPilot'}
        description={
          lang === 'hi'
            ? 'हर स्टेप का छोटा वीडियो देखें, फिर ऐप में वही करें। डेमो की ज़रूरत नहीं।'
            : 'Watch each short video, then do the same step in the app. No demo needed.'
        }
        className="max-w-4xl"
        data-testid="setup-popup"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">
            {setupCountLine(steps)} · {lang === 'hi' ? 'हर वीडियो एक मिनट से कम' : 'each video under a minute'}
          </p>
          <LangSwitch lang={lang} onChange={setLang} />
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%` }} />
        </div>

        <div className="mt-3 grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="min-w-0">
            {video ? (
              <video
                key={`${video.key}-${playsIn(video, lang)}`}
                className="aspect-video w-full rounded-lg bg-black"
                src={videoSrc(video, playsIn(video, lang))}
                poster={posterSrc(video, playsIn(video, lang))}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">Video coming soon</div>
            )}
            <p className="mt-2 font-semibold">
              {lang === 'hi' ? 'स्टेप' : 'Step'} {shown.n}: {shown.step.title[lang]}
              {video && video.seconds > 0 && <span className="ml-1 text-sm font-normal text-muted-foreground">· {lengthLabel(video.seconds)}</span>}
            </p>
            <p className="text-sm text-muted-foreground">{shown.step.why[lang]}</p>
          </div>

          <ol className="flex flex-col gap-1.5">
            {steps.map((s) => {
              const on = s === shown
              const isNext = s === next
              return (
                <li key={s.step.key}>
                  <button
                    type="button"
                    onClick={() => setPicked(s.step.key)}
                    aria-current={on ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      on ? 'border-primary bg-primary/10 font-semibold' : 'border-border hover:bg-accent',
                      !on && s.done && 'text-muted-foreground',
                      !on && isNext && 'border-dashed border-tone-amber bg-tone-amber-soft',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                        s.done ? 'border-success bg-success text-success-foreground' : 'border-input bg-card',
                      )}
                    >
                      {s.done ? <Check className="size-3.5" aria-hidden /> : s.n}
                    </span>
                    <span className={cn('min-w-0 flex-1', s.done && !on && 'line-through')}>{s.step.title[lang]}</span>
                    <Play className="size-3.5 shrink-0 text-primary" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => away(POPUP_GAP_HOURS)}>
              {lang === 'hi' ? 'बाद में' : 'Later'}
            </Button>
            <Button variant="ghost" onClick={() => away(20)}>
              {lang === 'hi' ? 'कल याद दिलाएँ' : 'Remind me tomorrow'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/start" onClick={() => away(POPUP_GAP_HOURS)}>
                {lang === 'hi' ? 'शुरू से सारे स्टेप' : 'All steps from zero'}
              </Link>
            </Button>
            {!shown.done && shown.step.key !== 'account' && (
              <Button
                onClick={() => {
                  away(POPUP_GAP_HOURS)
                  void navigate({ to: target.to, search: target.search as never })
                }}
              >
                {lang === 'hi' ? 'अभी करें' : 'Do this now'} <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
