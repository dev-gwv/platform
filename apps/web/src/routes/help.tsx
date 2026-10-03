import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Mail, MessageCircle, Play } from 'lucide-react'
import { useHelp, useTutorials } from '@/features/help/api'
import { TutorialPlayer } from '@/features/help/TutorialPlayer'
import { lengthLabel, posterSrc, type Tutorial } from '@/features/help/tutorials'
import { mailLink, whatsappLink } from '@/features/help/support'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Wordmark } from '@/shared/ui/wordmark'

const SECTIONS: Tutorial['section'][] = ['Get started', 'Clients & sales', 'Shoots & team', 'Editing', 'Money', 'Team']

/**
 * /help -- every tutorial, the questions studios ask, and a way to reach us.
 * Public, like /help/setup: an email or a WhatsApp message opens it signed
 * out, on a phone. A tutorial plays here in the same player the app uses.
 */
export function HelpPage() {
  const { session } = useAuth()
  const help = useHelp().data
  const tutorials = useTutorials()
  const [playing, setPlaying] = useState<Tutorial | null>(null)

  useEffect(() => {
    const before = document.title
    document.title = 'Help & tutorials · Studio AutoPilot'
    return () => {
      document.title = before
    }
  }, [])

  const message = 'Hi Studio AutoPilot team, I need help with:\n\n'
  const studio = session?.studios.find((s) => s.company_id === session.company_id)?.company_name ?? 'my studio'

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to={session ? '/dashboard' : '/'} className="text-lg font-semibold tracking-tight">
            <Wordmark />
          </Link>
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            Open the app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Help & tutorials</h1>
        <p className="mt-1 text-muted-foreground">Short videos of the real app. Each one is under a minute.</p>

        <div className="mt-8 flex flex-col gap-10">
          {SECTIONS.map((section) => {
            const list = tutorials.filter((t) => t.section === section)
            if (list.length === 0) return null
            return (
              <section key={section}>
                <h2 className="mb-3 text-lg font-semibold">{section}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t) => (
                    <TutorialCard key={t.key} tutorial={t} onPlay={() => setPlaying(t)} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        {(help?.faqs.length ?? 0) > 0 && (
          <section className="mt-12">
            <h2 className="mb-3 text-lg font-semibold">Questions studios ask</h2>
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
              {help!.faqs.map((f) => (
                <details key={f.id} className="group px-4 py-3">
                  <summary className="cursor-pointer list-none font-medium marker:hidden group-open:text-primary">{f.question}</summary>
                  <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {(help?.support_whatsapp || help?.support_email) && (
          <section className="mt-12 rounded-xl border border-border bg-card p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <h2 className="text-lg font-semibold">We're one message away</h2>
              <p className="text-sm text-muted-foreground">Still stuck? Tell us and we'll help you through it.</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 sm:mt-0">
              {help.support_whatsapp && (
                <Button asChild className="bg-[#25D366] text-white hover:bg-[#1ebe5b]">
                  <a href={whatsappLink(help.support_whatsapp, message)} target="_blank" rel="noreferrer">
                    <MessageCircle /> WhatsApp us
                  </a>
                </Button>
              )}
              {help.support_email && (
                <Button asChild variant="outline">
                  <a href={mailLink(help.support_email, studio, message)}>
                    <Mail /> Email us
                  </a>
                </Button>
              )}
            </div>
          </section>
        )}
      </main>
      <TutorialPlayer tutorial={playing} onClose={() => setPlaying(null)} />
    </div>
  )
}

function TutorialCard({ tutorial, onPlay }: { tutorial: Tutorial; onPlay: () => void }) {
  const poster = posterSrc(tutorial)
  return (
    <button
      type="button"
      onClick={onPlay}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition hover:border-primary/50 hover:shadow-md"
    >
      <span className="relative block aspect-video w-full bg-[#1b2a4a]">
        {poster && <img src={poster} alt="" loading="lazy" className="size-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition group-hover:bg-black/25">
          <span className="flex size-12 items-center justify-center rounded-full bg-white/95 text-[#1b2a4a] shadow-lg transition group-hover:scale-110">
            <Play className="ml-0.5 size-5 fill-current" aria-hidden />
          </span>
        </span>
        {tutorial.seconds > 0 && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
            {lengthLabel(tutorial.seconds)}
          </span>
        )}
      </span>
      <span className="flex flex-col gap-0.5 p-3">
        <span className="font-semibold">{tutorial.title}</span>
        {tutorial.blurb && <span className="text-sm text-muted-foreground">{tutorial.blurb}</span>}
      </span>
    </button>
  )
}
