import { useEffect, useRef, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/ui/cn'

/**
 * The AI tools' one shape (owner audit, 10 Nov: "a lot of empty space is left
 * on the right-hand side"): what you ask on the left, what the AI writes on
 * the right, side by side from 1024 px and stacked below. The right side
 * stays in view while the left scrolls, and says what will come before
 * anything is written.
 */
export function AiTwoPane({ ask, result, written }: { ask: ReactNode; result: ReactNode; written?: unknown }) {
  const out = useRef<HTMLDivElement>(null)
  // On a phone the answer lands under the questions: take the reader to it.
  useEffect(() => {
    if (written && window.innerWidth < 1024) out.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [written])
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-6">
      <div className="flex min-w-0 flex-col gap-4">{ask}</div>
      <div ref={out} className="min-w-0 scroll-mt-4 lg:sticky lg:top-4">{result}</div>
    </div>
  )
}

/** One numbered block of questions on the left. */
export function AiStep({ n, title, children, className }: { n: number; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', className)} aria-label={title}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A labelled row of chips. */
export function AiChoice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

export const aiChip = (on: boolean) =>
  cn(
    'rounded-full border px-3 py-1.5 text-sm transition-colors',
    on ? 'border-violet-600 bg-violet-600 text-white shadow-sm' : 'border-border bg-background hover:border-violet-400',
  )

/** A tile to pick what the writing is for: icon, name and a line. */
export function AiTile({
  on,
  icon: Icon,
  title,
  line,
  onClick,
  nudge,
}: {
  on: boolean
  icon: LucideIcon
  title: string
  line?: string
  onClick: () => void
  /** Amber dashed while nothing is picked yet. */
  nudge?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
        on ? 'border-violet-600 bg-violet-50 ring-1 ring-violet-600 dark:bg-violet-950/40' : 'border-border bg-background hover:border-violet-400',
        nudge && !on && 'border-dashed border-amber-400',
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          on ? 'bg-violet-600 text-white' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-snug">{title}</span>
        {line && <span className="block text-xs leading-snug text-muted-foreground">{line}</span>}
      </span>
    </button>
  )
}

/** The right side before anything is written: what will appear there. */
export function AiWaiting({ icon: Icon, title, lines }: { icon: LucideIcon; title: string; lines: string[] }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-violet-200 bg-gradient-to-br from-violet-50 via-background to-amber-50/60 p-8 text-center dark:border-violet-900 dark:from-violet-950/30 dark:to-background">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg">
        <Icon className="size-8" aria-hidden />
      </span>
      <p className="text-lg font-semibold">{title}</p>
      <ul className="flex max-w-sm flex-col gap-1.5 text-sm text-muted-foreground">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  )
}
