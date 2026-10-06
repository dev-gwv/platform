import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, Plus } from 'lucide-react'
import { companySetupResult } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { checkpointsFor, isSetupAudience, nextStep, SETUP_TOTAL, setupLanding, stepForPath, type JourneyStepKey } from './journey'
import { SetupCheckpoints } from './SetupCheckpoints'

/**
 * The setup walk-through's thread through the rest of the app.
 *
 * Every setup step links out with `?from=setup`. That one marker is what lets
 * a page reached from setup behave like a step of it: say which step it is at
 * the top, and, once its job is done, move straight on to the next step.
 */
export const SETUP_SEARCH = { from: 'setup' } as const

/** Whether this page was opened from setup. Reactive to navigation. */
export function useFromSetup(): boolean {
  const { search } = useLocation()
  return (search as Record<string, unknown>).from === 'setup'
}

/**
 * Close setup for this studio, for good: 'done' after the last step, 'skip'
 * from "Skip setup". The session is re-read so everything that reads
 * `setup_done` (the dashboard card, the guide bar, sign-in landing) agrees.
 */
export function useCloseSetup() {
  const { refresh } = useAuth()
  return async (action: 'done' | 'skip') => {
    try {
      await callApi('/settings/company/setup', {
        method: 'PATCH',
        body: { action },
        responseSchema: companySetupResult,
      })
      await refresh()
    } catch {
      // Not worth interrupting anyone for: the worst case is setup showing
      // again next time, where it can be closed again.
    }
  }
}

/** Pages a refresh never pulls away from: help, the guide, and the platform admin's own screens. */
const RESUME_EXEMPT = ['/help', '/learn', '/platform']

let resumeChecked = false

/**
 * Once per load of the app (opening it, or pressing refresh): an owner whose
 * studio is still being set up is taken back to the step they are on. The
 * owner signed up, landed somewhere else, refreshed, and was never brought
 * back to the steps; setup was only offered at the moment of sign-in. Moving
 * around after that is free -- this runs once, not on every page.
 */
export function useResumeSetup() {
  const { session } = useAuth()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (resumeChecked || !session) return
    resumeChecked = true
    const landing = setupLanding(session)
    if (!landing) return
    if (pathname === landing.to && (search as Record<string, unknown>).from === 'setup') return
    if (RESUME_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return
    void navigate({ to: landing.to, search: landing.search as never, replace: true })
  }, [session, pathname, search, navigate])
}

/**
 * Pulse the page's primary add button once, so the eye lands on it. The
 * button carries `data-setup-nudge`; it may render a moment after the page
 * does, so look for it for a short while.
 */
function useNudgeOnce(active: boolean, key: string) {
  useEffect(() => {
    if (!active) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const look = () => {
      const el = document.querySelector<HTMLElement>('[data-setup-nudge]')
      if (el) {
        el.classList.add('ipc-nudge')
        const clear = () => el.classList.remove('ipc-nudge')
        el.addEventListener('animationend', clear, { once: true })
        timer = setTimeout(clear, 2500)
        return
      }
      if (++tries < 20) timer = setTimeout(look, 100)
    }
    look()
    return () => clearTimeout(timer)
  }, [active, key])
}

/**
 * The bar across the top of a page opened from setup. Two lines: the three
 * checkpoints, then which step this page is and why it matters:
 * "Step 1 of 3 · Add your team — the people who shoot and edit with you."
 */
export function SetupGuideBar() {
  const fromSetup = useFromSetup()
  const { pathname } = useLocation()
  const { session } = useAuth()
  const navigate = useNavigate()
  const closeSetup = useCloseSetup()
  const [skipping, setSkipping] = useState(false)
  const step = stepForPath(pathname)
  const show = fromSetup && !!step && !!session && isSetupAudience(session) && !session.setup_done
  useNudgeOnce(show, pathname)

  if (!show || !step) return null
  return (
    <div className="mb-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
      <SetupCheckpoints steps={checkpointsFor(step.step)} />
      <div className="mt-1.5 flex items-start gap-3">
        <p className="min-w-0 flex-1">
          <span className="font-medium text-primary">
            Step {step.step} of {SETUP_TOTAL} · {step.title}
          </span>
          <span className="text-muted-foreground"> — {step.why.charAt(0).toLowerCase() + step.why.slice(1)}</span>{' '}
          <Link
            to="/help/setup"
            hash={step.key}
            className="whitespace-nowrap text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Watch how (under a minute)
          </Link>
        </p>
        <button
          type="button"
          disabled={skipping}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={async () => {
            setSkipping(true)
            await closeSetup('skip')
            setSkipping(false)
            void navigate({ to: '/dashboard' })
          }}
        >
          Skip setup
        </button>
      </div>
    </div>
  )
}

/**
 * "Added. Add another, or go to step 2?" after the first of something is saved.
 *
 * From setup, the main choice is the next setup step, by number, and it goes
 * straight to that step's page. Otherwise it simply closes.
 */
export function AddMorePrompt({
  open,
  title,
  description,
  moreLabel,
  onMore,
  onDone,
  fromSetup,
  step,
  noun = 'person',
}: {
  open: boolean
  title: string
  description: string
  moreLabel: string
  onMore: () => void
  onDone: () => void
  fromSetup: boolean
  /** The setup step this page is. */
  step: JourneyStepKey
  /** What one of these is called: "Add another person". */
  noun?: string
}) {
  const navigate = useNavigate()
  const next = fromSetup ? nextStep(step) : null
  const goNext = () => {
    onDone()
    if (next) void navigate({ to: next.action.to, search: next.action.search as never })
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="max-w-md">
        <div className="flex flex-col items-center gap-2 pt-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          {next ? (
            <>
              <h2 className="text-lg font-semibold">Added.</h2>
              <p className="text-sm text-muted-foreground">
                Add another {noun}, or go to step {next.step}.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          {next ? (
            <>
              <Button className="flex-1" onClick={goNext}>
                Step {next.step}: {next.title} <ArrowRight />
              </Button>
              <Button variant="outline" className="flex-1" onClick={onMore}>
                <Plus /> Add another
              </Button>
            </>
          ) : (
            <>
              <Button className="flex-1" onClick={onMore}>
                <Plus /> {moreLabel}
              </Button>
              <Button variant="outline" className="flex-1" onClick={onDone}>
                No, I&apos;m done
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

