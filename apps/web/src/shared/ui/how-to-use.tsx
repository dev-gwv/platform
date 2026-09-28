import { useState } from 'react'
import { HelpCircle, Lightbulb } from 'lucide-react'
import { cn } from './cn'

const KEY = (id: string) => `howto:${id}`
const readClosed = (id: string) => {
  try {
    return localStorage.getItem(KEY(id)) === '1'
  } catch {
    return false
  }
}
const writeClosed = (id: string, closed: boolean) => {
  try {
    if (closed) localStorage.setItem(KEY(id), '1')
    else localStorage.removeItem(KEY(id))
  } catch {
    /* a private window forgets; the box just shows again next time */
  }
}

/**
 * "What to do here": the box at the top of a working page that tells a
 * first-timer what the page is for and the three moves that get it done.
 *
 * The owner's rule: every page takes the person in. A photographer who has
 * never seen the app should know in five seconds what this screen is and
 * what to press -- so this is bold, tinted, and first, not a grey line
 * under a heading. Give it an `id` and it gains a "Got it" that closes it
 * for that person (remembered in this browser) and a small "How does this
 * page work?" link to bring it back. Without an `id` it stays put, as the
 * map for whoever inherits the studio account later.
 */
export function HowToUse({
  id,
  title,
  description,
  steps = [],
  className,
}: {
  /** A stable key; with one, the box can be closed and stays closed. */
  id?: string | undefined
  title: string
  description: string
  steps?: readonly string[]
  className?: string
}) {
  const [closed, setClosed] = useState(() => (id ? readClosed(id) : false))
  const close = (v: boolean) => {
    if (!id) return
    setClosed(v)
    writeClosed(id, v)
  }

  if (closed) {
    return (
      <button
        type="button"
        onClick={() => close(false)}
        className={cn('inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline', className)}
      >
        <HelpCircle className="size-3.5" /> How does this page work?
      </button>
    )
  }

  return (
    <section
      aria-label="What to do here"
      className={cn('rounded-xl border border-primary/20 border-l-4 border-l-primary bg-primary/[0.06] p-4', className)}
    >
      <div className="flex gap-3">
        <span className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
          <Lightbulb className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-primary">What to do here</p>
          <h2 className="mt-0.5 text-lg font-bold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-foreground/80">{description}</p>

          {steps.length > 0 && (
            <ol className="mt-3 grid gap-2 sm:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s} className="flex items-start gap-2 rounded-lg border border-primary/15 bg-card px-3 py-2 text-sm font-medium">
                  <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[0.7rem] font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          )}

          {id && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => close(true)}
                className="rounded-md border border-primary/30 bg-card px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
              >
                Got it
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
