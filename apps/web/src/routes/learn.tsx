import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Check, ChevronDown, Play } from 'lucide-react'
import { useHints, useSetHint } from '@/features/team/hints-api'
import { useTutorials } from '@/features/help/api'
import { CHAPTERS, PARTS, TRACK_LABEL, chaptersOf, nextChapter, stepParts, type GuideChapter, type GuideTrack } from '@/features/help/guide'
import { useHelpLang } from '@/features/help/lang'
import { LangSwitch, TutorialPlayer } from '@/features/help/TutorialPlayer'
import { lengthLabel, posterSrc, titleIn, type HelpLang, type Tutorial } from '@/features/help/tutorials'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { seesStudioWork } from '@ipc/permissions'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Wordmark } from '@/shared/ui/wordmark'

const WORDS = {
  title: { en: 'How to use Studio AutoPilot', hi: 'Studio AutoPilot कैसे इस्तेमाल करें' },
  done: { en: (n: number, of: number) => `${n} of ${of} done`, hi: (n: number, of: number) => `${of} में से ${n} पूरे` },
  allDone: { en: 'All done. You know Studio AutoPilot.', hi: 'सब पूरा। अब आप Studio AutoPilot जानते हैं।' },
  open: { en: 'Do it in the app', hi: 'ऐप में करें' },
  markDone: { en: 'I have done this', hi: 'मैंने यह कर लिया' },
  isDone: { en: 'Done', hi: 'पूरा' },
  watch: { en: 'Watch', hi: 'देखें' },
  step: { en: 'Step', hi: 'स्टेप' },
  appLink: { en: 'Open the app', hi: 'ऐप खोलें' },
} as const

const DONE_KEY = 'learn-done'

function readDone(): Set<string> {
  try {
    const v = JSON.parse(window.localStorage.getItem(DONE_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * /learn -- "How to use Studio AutoPilot": every job in the app, in order,
 * each with its video and the steps written out, in English or Hindi. Public
 * like /help, so a link on WhatsApp opens it on a phone; `?lang=hi` opens it
 * in Hindi. Staff land on their own track. "I have done this" is remembered
 * on this device; opening the guide retires the dashboard's note about it.
 */
export function LearnPage() {
  const { session } = useAuth()
  const access = useAccess()
  const staff = !!session && !seesStudioWork(access)
  const [lang, setLang] = useHelpLang()
  const [track, setTrack] = useState<GuideTrack>(staff ? 'team' : 'studio')
  const [done, setDone] = useState<Set<string>>(readDone)
  const [open, setOpen] = useState<string | null>(() => nextChapter(staff ? 'team' : 'studio', readDone())?.key ?? null)
  const [playing, setPlaying] = useState<Tutorial | null>(null)
  const tutorials = useTutorials()
  const byKey = useMemo(() => new Map(tutorials.map((t) => [t.key, t])), [tutorials])

  // Staff whose session arrives after the first paint start on their own track.
  useEffect(() => {
    if (!staff) return
    setTrack('team')
    setOpen(nextChapter('team', readDone())?.key ?? null)
  }, [staff])

  // Opening the guide is what the dashboard's note asked for: it goes.
  const hints = useHints()
  const setHint = useSetHint()
  const closed = hints.data?.guide?.closed
  useEffect(() => {
    if (session && hints.isSuccess && !closed) setHint.mutate({ key: 'guide', value: { shown: (hints.data?.guide?.shown ?? 0) + 1, closed: true } })
  }, [session, hints.isSuccess, closed])

  useEffect(() => {
    const before = document.title
    document.title = `${WORDS.title[lang]} · Studio AutoPilot`
    return () => {
      document.title = before
    }
  }, [lang])

  const list = chaptersOf(track)
  const doneHere = list.filter((c) => done.has(c.key)).length

  const toggleDone = (key: string) => {
    const next = new Set(done)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setDone(next)
    try {
      window.localStorage.setItem(DONE_KEY, JSON.stringify([...next]))
    } catch {
      // Still ticked for this visit.
    }
    // Ticking one done opens the next.
    if (next.has(key)) setOpen(nextChapter(track, next)?.key ?? null)
  }

  const switchTrack = (t: GuideTrack) => {
    setTrack(t)
    setOpen(nextChapter(t, done)?.key ?? null)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to={session ? '/dashboard' : '/'} className="text-lg font-semibold tracking-tight">
            <Wordmark />
          </Link>
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            {WORDS.appLink[lang]}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{WORDS.title[lang]}</h1>
          <LangSwitch lang={lang} onChange={setLang} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2" role="tablist">
          {(['studio', 'team'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={track === t}
              onClick={() => switchTrack(t)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                track === t ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {TRACK_LABEL[t][lang]}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <p className={cn('text-sm font-medium', doneHere === list.length ? 'text-success' : 'text-muted-foreground')}>
            {doneHere === list.length ? WORDS.allDone[lang] : WORDS.done[lang](doneHere, list.length)}
          </p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${(doneHere / list.length) * 100}%` }} />
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-8">
          {PARTS.map((part, i) => {
            if (part.track !== track) return null
            const here = CHAPTERS.filter((c) => c.part === i)
            return (
              <section key={i}>
                <h2 className="mb-3 text-lg font-semibold">{part.title[lang]}</h2>
                <ol className="flex flex-col gap-3">
                  {here.map((c) => (
                    <ChapterCard
                      key={c.key}
                      chapter={c}
                      number={list.indexOf(c) + 1}
                      lang={lang}
                      isOpen={open === c.key}
                      isDone={done.has(c.key)}
                      onToggle={() => setOpen(open === c.key ? null : c.key)}
                      onDone={() => toggleDone(c.key)}
                      byKey={byKey}
                      onPlay={setPlaying}
                    />
                  ))}
                </ol>
              </section>
            )
          })}
        </div>
      </main>
      <TutorialPlayer tutorial={playing} onClose={() => setPlaying(null)} />
    </div>
  )
}

function ChapterCard({
  chapter: c,
  number,
  lang,
  isOpen,
  isDone,
  onToggle,
  onDone,
  byKey,
  onPlay,
}: {
  chapter: GuideChapter
  number: number
  lang: HelpLang
  isOpen: boolean
  isDone: boolean
  onToggle: () => void
  onDone: () => void
  byKey: Map<string, Tutorial>
  onPlay: (t: Tutorial) => void
}) {
  const video = c.video ? byKey.get(c.video) : undefined
  const clips = (c.clips ?? []).map((k) => byKey.get(k)).filter((t): t is Tutorial => !!t)
  const poster = video ? posterSrc(video, lang) : undefined
  return (
    <li className={cn('overflow-hidden rounded-xl border bg-card shadow-sm', isDone ? 'border-success/40' : isOpen ? 'border-primary/40' : 'border-border')}>
      <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums',
            isDone ? 'bg-success text-white' : 'bg-primary/10 text-primary',
          )}
        >
          {isDone ? <Check className="size-4" aria-hidden /> : number}
        </span>
        <span className="min-w-0 flex-1 font-semibold">{c.title[lang]}</span>
        {video && !isOpen && (
          <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
            <Play className="size-3 fill-current" aria-hidden /> {lengthLabel(video.seconds)}
          </span>
        )}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} aria-hidden />
      </button>

      {isOpen && (
        <div className="flex flex-col gap-4 border-t border-border px-4 pb-4 pt-4 sm:flex-row">
          {video && (
            <div className="flex shrink-0 flex-col gap-2 sm:w-64">
              <button
                type="button"
                onClick={() => onPlay(video)}
                className="group relative block aspect-video w-full overflow-hidden rounded-lg border border-border bg-[#1b2a4a]"
                aria-label={`${WORDS.watch[lang]}: ${titleIn(video, lang)}`}
              >
                {poster && <img src={poster} alt="" loading="lazy" className="size-full object-cover" />}
                <span className="absolute inset-0 flex items-center justify-center bg-black/15 transition group-hover:bg-black/30">
                  <span className="flex size-11 items-center justify-center rounded-full bg-white/95 text-[#1b2a4a] shadow-lg transition group-hover:scale-110">
                    <Play className="ml-0.5 size-5 fill-current" aria-hidden />
                  </span>
                </span>
                {video.seconds > 0 && (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
                    {lengthLabel(video.seconds)}
                  </span>
                )}
              </button>
              {clips.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {clips.map((t, i) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => onPlay(t)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary"
                    >
                      <Play className="size-3 fill-current" aria-hidden />
                      {clips.length > 1 ? `${WORDS.step[lang]} ${i + 1}` : titleIn(t, lang)} · {lengthLabel(t.seconds)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <ol className="flex flex-col gap-2.5">
              {c.steps[lang].map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span>
                    {stepParts(s).map((p, j) =>
                      p.strong ? (
                        <b key={j} className="font-semibold text-foreground">
                          {p.text}
                        </b>
                      ) : (
                        <span key={j}>{p.text}</span>
                      ),
                    )}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              {c.to && (
                <Button asChild size="sm" variant="outline">
                  <Link to={c.to}>
                    {WORDS.open[lang]} <ArrowRight />
                  </Link>
                </Button>
              )}
              <Button size="sm" variant={isDone ? 'outline' : 'default'} onClick={onDone} className={cn(isDone && 'border-success/50 text-success')}>
                <Check /> {isDone ? WORDS.isDone[lang] : WORDS.markDone[lang]}
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}
