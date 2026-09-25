import { useEffect, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { LEGAL, LEGAL_LINKS } from './legal'

/**
 * The shell every policy page shares: the brand, a way back to sign in, the
 * page itself as a readable document, and links to the other three.
 */
export function LegalPage({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  useEffect(() => {
    const before = document.title
    document.title = `${title} · ${LEGAL.appName}`
    return () => {
      document.title = before
    }
  }, [title])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/login" className="text-lg font-semibold tracking-tight">
            <span className="text-brand">IPC</span> Studios
          </Link>
          <Link to="/login" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden /> Back to sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated: {LEGAL.lastUpdated}</p>
        {intro && <p className="mt-4 leading-relaxed text-foreground/90">{intro}</p>}
        <div className="mt-6 flex flex-col gap-6">{children}</div>
        <LegalLinks className="mt-10 border-t border-border pt-6" />
      </main>
    </div>
  )
}

export function LegalSection({ n, title, children }: { n?: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold">
        {n != null && <span className="mr-1 text-muted-foreground tabular-nums">{n}.</span>}
        {title}
      </h2>
      <div className="mt-2 flex flex-col gap-2 text-sm leading-relaxed text-foreground/85 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  )
}

/** The four policy links, for the sign-in page and each policy page's foot. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Policies" className={cn('flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground', className)}>
      {LEGAL_LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="hover:text-foreground hover:underline">
          {l.label}
        </Link>
      ))}
    </nav>
  )
}
