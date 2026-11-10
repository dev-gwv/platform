import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ArrowRight, Check, Play } from 'lucide-react'
import { SETUP_VIDEOS, setupLength, type SetupVideoStep } from '@/features/onboarding/setup-videos'
import { useHelpLang } from '@/features/help/lang'
import { LangSwitch } from '@/features/help/TutorialPlayer'
import { TUTORIALS, lengthLabel, posterSrc, titleIn, videoSrc, type HelpLang, type Tutorial } from '@/features/help/tutorials'
import { stepParts } from '@/features/help/guide'
import { BookCallButton } from '@/features/help/BookCall'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Wordmark } from '@/shared/ui/wordmark'

/**
 * /help/setup (also /start) — set up Studio AutoPilot, step by step.
 *
 * Public on purpose: the sign-in page, the setup emails (`#team`, `#client`,
 * `#project`) and a WhatsApp message all link here, often opened signed out on
 * a phone. Each numbered step is its video, in English or Hindi, every click
 * written out, "I have done this", and one button into the app (signed out,
 * it goes by way of sign-in, which brings them back). Owner, 10 Nov: new
 * studios felt unsure the first time they signed in.
 */
const WORDS = {
  title: { en: 'Set up Studio AutoPilot, step by step', hi: 'Studio AutoPilot सेटअप, स्टेप बाय स्टेप' },
  intro: {
    en: (n: number, min: number) => `${n} short videos · about ${min} minutes. Watch one, do it, then the next.`,
    hi: (n: number, min: number) => `${n} छोटे वीडियो · लगभग ${min} मिनट। एक देखें, वही करें, फिर अगला।`,
  },
  done: { en: (n: number, of: number) => `${n} of ${of} done`, hi: (n: number, of: number) => `${of} में से ${n} पूरे` },
  allDone: { en: 'All set. Your studio is ready.', hi: 'सब तैयार। आपका स्टूडियो तैयार है।' },
  step: { en: 'Step', hi: 'स्टेप' },
  optional: { en: 'Optional', hi: 'चाहें तो' },
  howTo: { en: 'What to do', hi: 'क्या करना है' },
  parts: { en: 'Watch each part', hi: 'हर हिस्सा अलग से देखें' },
  part: { en: 'Part', hi: 'हिस्सा' },
  markDone: { en: 'I have done this', hi: 'मैंने यह कर लिया' },
  isDone: { en: 'Done', hi: 'हो गया' },
  stuck: { en: 'Stuck anywhere? We will set it up with you.', hi: 'कहीं अटक गए? हम आपके साथ सेट कर देंगे।' },
  openApp: { en: 'Open the app', hi: 'ऐप खोलें' },
} as const

const DONE_KEY = 'setup-videos-done'

function readDone(): Set<string> {
  try {
    const v = JSON.parse(window.localStorage.getItem(DONE_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function HelpSetupPage() {
  const { hash } = useLocation()
  const [lang, setLang] = useHelpLang()
  const [done, setDone] = useState<Set<string>>(readDone)
  const byKey = useMemo(() => new Map(TUTORIALS.map((t) => [t.key, t])), [])
  const total = SETUP_VIDEOS.length
  const minutes = setupLength(SETUP_VIDEOS.map((s) => byKey.get(s.video)?.seconds ?? 60))
  const doneHere = SETUP_VIDEOS.filter((s) => done.has(s.key)).length

  useEffect(() => {
    const before = document.title
    document.title = `${WORDS.title[lang]} · Studio AutoPilot`
    return () => {
      document.title = before
    }
  }, [lang])

  // Land on the step the email (or the setup bar) was about. The videos
  // reserve their height, so the target does not move once scrolled to.
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id) return
    const el = document.getElementById(id)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [hash])

  const toggle = (key: string) => {
    const next = new Set(done)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setDone(next)
    try {
      window.localStorage.setItem(DONE_KEY, JSON.stringify([...next]))
    } catch {
      /* a private window: kept for this visit only */
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            <Wordmark />
          </Link>
          <Link to="/dashboard" className="text-sm font-medium text-primary hover:underline">
            {WORDS.openApp[lang]}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{WORDS.title[lang]}</h1>
          <LangSwitch lang={lang} onChange={setLang} />
        </div>
        <p className="mt-2 text-muted-foreground">{WORDS.intro[lang](total, minutes)}</p>
        <div className="mt-4">
          <p className={cn('text-sm font-medium', doneHere === total ? 'text-success' : 'text-muted-foreground')}>
            {doneHere === total ? WORDS.allDone[lang] : WORDS.done[lang](doneHere, total)}
          </p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${(doneHere / total) * 100}%` }} />
          </div>
        </div>

        <ol className="mt-6 flex gap-1.5 overflow-x-auto pb-1" aria-label={WORDS.title[lang]}>
          {SETUP_VIDEOS.map((s, i) => (
            <li key={s.key} className="shrink-0">
              <a
                href={`#${s.key}`}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                  done.has(s.key) ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-card hover:border-primary/50',
                )}
              >
                {done.has(s.key) ? <Check className="size-3" aria-hidden /> : <span className="tabular-nums">{i + 1}</span>}
                {s.title[lang]}
              </a>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-col gap-12">
          {SETUP_VIDEOS.map((s, i) => (
            <StepSection
              key={s.key}
              s={s}
              n={i + 1}
              lang={lang}
              byKey={byKey}
              isDone={done.has(s.key)}
              onDone={() => toggle(s.key)}
            />
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="font-semibold">{WORDS.stuck[lang]}</p>
          <BookCallButton />
        </div>
      </main>
    </div>
  )
}

function StepSection({
  s,
  n,
  lang,
  byKey,
  isDone,
  onDone,
}: {
  s: SetupVideoStep
  n: number
  lang: HelpLang
  byKey: Map<string, Tutorial>
  isDone: boolean
  onDone: () => void
}) {
  const main = byKey.get(s.video)
  const parts = (s.parts ?? []).map((k) => byKey.get(k)).filter((t): t is Tutorial => !!t)
  const [playing, setPlaying] = useState<Tutorial | undefined>(main)
  useEffect(() => {
    setPlaying(main)
  }, [main])
  return (
    <section id={s.key} className="scroll-mt-4">
      <h2 className="flex items-center gap-2.5 text-xl font-bold">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full text-base tabular-nums text-white',
            isDone ? 'bg-success' : 'bg-primary',
          )}
        >
          {isDone ? <Check className="size-5" aria-hidden /> : n}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {WORDS.step[lang]} {n}
            {s.optional && ` · ${WORDS.optional[lang]}`}
          </span>
          {s.title[lang]}
        </span>
      </h2>
      <p className="mt-2 text-muted-foreground">{s.why[lang]}</p>
      {playing && (
        <video
          key={`${playing.key}-${lang}`}
          className="mt-4 aspect-video w-full rounded-lg border border-border bg-muted shadow-sm"
          controls
          playsInline
          preload="metadata"
          poster={posterSrc(playing, lang)}
          width={1280}
          height={720}
          aria-label={titleIn(playing, lang)}
        >
          <source src={videoSrc(playing, lang)} type="video/mp4" />
        </video>
      )}
      {parts.length > 0 && main && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{WORDS.parts[lang]}</p>
          <div className="flex flex-wrap gap-1.5">
            {[main, ...parts].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPlaying(t)}
                aria-pressed={playing?.key === t.key}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
                  playing?.key === t.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/50',
                )}
              >
                <Play className="size-3 fill-current" aria-hidden />
                {titleIn(t, lang)} · {lengthLabel(t.seconds)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-5 rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-2 text-sm font-semibold">{WORDS.howTo[lang]}</p>
        <ol className="flex flex-col gap-2">
          {s.steps[lang].map((line, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary tabular-nums">
                {i + 1}
              </span>
              <span>
                {stepParts(line).map((p, j) => (p.strong ? <strong key={j}>{p.text}</strong> : <span key={j}>{p.text}</span>))}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link to={s.action.to} search={s.action.search as never}>
            {s.action.label[lang]} <ArrowRight />
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          className={cn(isDone && 'border-success/50 bg-success/10 text-success hover:bg-success/15')}
        >
          <Check /> {isDone ? WORDS.isDone[lang] : WORDS.markDone[lang]}
        </Button>
      </div>
    </section>
  )
}
