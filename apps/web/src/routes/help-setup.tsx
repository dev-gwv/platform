import { useEffect } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { JOURNEY_STEPS } from '@/features/onboarding/journey'
import { Button } from '@/shared/ui/button'

/**
 * /help/setup — one short screen recording per setup step.
 *
 * Public on purpose: the setup emails link here (`#team`, `#client`,
 * `#project`) and an email is often opened signed out, on a phone. Each
 * section is the step, its video and one button into the app; signed out,
 * that button goes by way of sign-in, which brings them back.
 *
 * The videos are real recordings of these pages, kept under apps/web/public/help
 * next to a poster frame of the same name.
 */
export function HelpSetupPage() {
  const { hash } = useLocation()
  useEffect(() => {
    const before = document.title
    document.title = 'Set up your studio in 3 steps'
    return () => {
      document.title = before
    }
  }, [])

  // Land on the step the email (or the guide bar) was about, on first load and
  // on a hash-only navigation. The videos reserve their height, so the target
  // does not move once scrolled to.
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id) return
    const el = document.getElementById(id)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [hash])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/dashboard" className="text-lg font-semibold tracking-tight">
            <span className="text-brand">IPC</span> Studios
          </Link>
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            Open the app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Set up your studio in 3 steps</h1>
        <p className="mt-1 text-muted-foreground">Each video is under a minute.</p>

        <div className="mt-8 flex flex-col gap-12">
          {JOURNEY_STEPS.map((s, i) => (
            <section key={s.key} id={s.key} className="scroll-mt-4">
              <h2 className="flex items-baseline gap-2 text-lg font-semibold">
                <span className="flex size-7 shrink-0 items-center justify-center self-center rounded-full bg-primary text-sm text-primary-foreground tabular-nums">
                  {i + 1}
                </span>
                {s.title}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{s.why}</p>
              <video
                className="mt-4 aspect-video w-full rounded-lg border border-border bg-muted shadow-sm"
                controls
                playsInline
                preload="metadata"
                poster={`/help/${s.key}.jpg`}
                width={1280}
                height={720}
              >
                <source src={`/help/${s.key}.webm`} type="video/webm" />
              </video>
              <Button asChild className="mt-4">
                <Link to={s.action.to} search={s.action.search as never}>
                  Do it now <ArrowRight />
                </Link>
              </Button>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
