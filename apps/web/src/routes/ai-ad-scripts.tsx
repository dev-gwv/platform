import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BadgePercent,
  BookOpen,
  Check,
  Clapperboard,
  Copy,
  Heart,
  Loader2,
  MessageCircle,
  MonitorPlay,
  Plus,
  RefreshCw,
  ShieldQuestion,
  Shuffle,
  Sparkles,
  TriangleAlert,
  User,
  UserRound,
  Users,
  Megaphone,
  type LucideIcon,
} from 'lucide-react'
import {
  AD_LENGTHS,
  AI_LANGS,
  AI_TONES,
  adScriptReply,
  userHints,
  type AdAsk,
  type AdCta,
  type AdScript,
  type AdScriptRequest,
  type AdSpeaker,
  type AiLang,
  type AiTone,
  type UserHints,
} from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { callApi } from '@/shared/api/client'
import { useCompanyProfile } from '@/features/settings/api'
import { usePersonalWords } from '@/features/settings/quick-words'
import { LANG_NAMES, TONE_NAMES } from '@/features/crm-ai/intents'
import { AiChoice, AiStep, AiTile, AiTwoPane, AiWaiting, aiChip } from '@/features/ai/parts'
import { Teleprompter } from '@/features/ai/Teleprompter'
import { spokenText } from '@/features/ai/teleprompter'

export function AiAdScriptsPage() {
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <PageHeader title="Ad scripts" />
      <ScriptMaker />
    </AuthedPage>
  )
}

const STRENGTHS = [
  'Candid photography',
  'Cinematic wedding films',
  'Drone shots',
  'Same-day edit',
  'Premium albums',
  'Destination weddings',
  'Fast delivery',
  'Female photographers',
  'Pre-wedding shoots',
  'Big team for big weddings',
]

const SPEAKERS: { key: AdSpeaker; title: string; icon: LucideIcon }[] = [
  { key: 'female', title: 'Female model', icon: UserRound },
  { key: 'male', title: 'Male model', icon: User },
  { key: 'couple', title: 'A couple', icon: Users },
  { key: 'owner', title: 'You, the owner', icon: Megaphone },
]

const ANGLES: { key: AdAsk; title: string; line: string; icon: LucideIcon }[] = [
  { key: 'mix', title: 'Three different ones', line: 'Teach · invite · a story', icon: Shuffle },
  { key: 'how_to_choose', title: 'How to choose a photographer', line: 'Give value, then invite', icon: BookOpen },
  { key: 'invite', title: 'Direct invitation', line: 'Straight to the point', icon: Megaphone },
  { key: 'mistakes', title: 'Mistakes couples make', line: 'Two or three, then you', icon: TriangleAlert },
  { key: 'myth', title: 'Myth vs truth', line: 'Bust a myth', icon: ShieldQuestion },
  { key: 'story', title: "A wedding moment", line: 'Emotional', icon: Heart },
  { key: 'dates_offer', title: 'Dates filling up', line: 'Or your offer', icon: BadgePercent },
]

const CTAS: { key: AdCta; label: string }[] = [
  { key: 'get_quote', label: 'Get Quote button' },
  { key: 'whatsapp', label: 'WhatsApp us' },
  { key: 'call', label: 'Call us' },
]

const ANGLE_NAME: Record<string, string> = Object.fromEntries(ANGLES.map((a) => [a.key, a.title]))

/** What a studio typed about itself, kept on the device so it is typed once. */
interface Facts {
  studio: string
  city: string
  weddings: string
  years: string
  rating: string
  strengths: string[]
  extra: string
}
/** The choices, kept with the facts so leaving the page loses nothing. */
interface Choices {
  speaker: AdSpeaker
  angle: AdAsk
  lang: AiLang
  tone: AiTone
  seconds: number
  cta: AdCta
  offer: string
}
/** A batch of scripts and the length and language they were written for. */
interface Batch {
  scripts: AdScript[]
  seconds: number
}
const CHOICES_KEY = 'ad-scripts:choices'
const FACTS_KEY = 'ad-scripts:facts'
const LAST_KEY = 'ad-scripts:last'

function readStored<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function store(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private window: kept for this visit only */
  }
}

/**
 * Ad scripts (owner, 10 Nov): the studio's facts in a few taps, then three
 * scripts a model reads to camera for a Meta ad, each on its own angle, with
 * the hook, timed parts, on-screen lines and notes for the model. Copy,
 * WhatsApp or the Teleprompter hand it over. Nothing is posted from here.
 */
function ScriptMaker() {
  const company = useCompanyProfile()
  const qc = useQueryClient()
  const saved = useMemo(() => readStored<Facts>(FACTS_KEY), [])
  const [facts, setFacts] = useState<Facts>(
    saved ?? { studio: '', city: '', weddings: '', years: '', rating: '', strengths: [], extra: '' },
  )
  const [choices, setChoices] = useState<Choices>(() => ({
    speaker: 'female',
    angle: 'mix',
    lang: 'hi',
    tone: 'warm',
    seconds: 60,
    cta: 'get_quote',
    offer: '',
    ...(readStored<Partial<Choices>>(CHOICES_KEY) ?? {}),
  }))
  const { speaker, angle, lang, tone, seconds, cta, offer } = choices
  const choose = (patch: Partial<Choices>) =>
    setChoices((c) => {
      const next = { ...c, ...patch }
      store(CHOICES_KEY, next)
      return next
    })
  const setSpeaker = (v: AdSpeaker) => choose({ speaker: v })
  const setAngle = (v: AdAsk) => choose({ angle: v })
  const setLang = (v: AiLang) => choose({ lang: v })
  const setTone = (v: AiTone) => choose({ tone: v })
  const setSeconds = (v: number) => choose({ seconds: v })
  const setCta = (v: AdCta) => choose({ cta: v })
  const setOffer = (v: string) => choose({ offer: v })
  const [adding, setAdding] = useState('')
  const [batch, setBatch] = useState<Batch | null>(() => {
    const stored = readStored<Batch | AdScript[]>(LAST_KEY)
    // Before 11 Nov the last scripts were kept without their length.
    if (Array.isArray(stored)) return { scripts: stored, seconds: 60 }
    return stored?.scripts ? stored : null
  })
  const scripts = batch?.scripts ?? null
  const [again, setAgain] = useState<number | null>(null)
  const ownWords = usePersonalWords('ad_strength')
  const strengths = useMemo(() => [...new Set([...STRENGTHS, ...ownWords, ...facts.strengths])], [ownWords, facts.strengths])

  // The studio's name and city come from its profile until the studio types its own.
  useEffect(() => {
    const p = company.data
    if (!p) return
    setFacts((f) => ({ ...f, studio: f.studio || p.display_name || p.name || '', city: f.city || p.city || '' }))
  }, [company.data])

  const set = (patch: Partial<Facts>) =>
    setFacts((f) => {
      const next = { ...f, ...patch }
      store(FACTS_KEY, next)
      return next
    })

  const keepWord = useMutation({
    mutationFn: (word: string) =>
      callApi('/auth/quick-words', { method: 'PUT', body: { category: 'ad_strength', word }, responseSchema: userHints }),
    onSuccess: (hints: UserHints) => qc.setQueryData(['me', 'hints'], hints),
  })

  const write = useMutation({
    mutationFn: (body: AdScriptRequest) =>
      callApi('/designs/ad-scripts', { method: 'POST', body, responseSchema: adScriptReply }),
  })

  const ask = (over: Partial<AdScriptRequest> = {}): AdScriptRequest => ({
    studio: facts.studio.trim(),
    city: facts.city.trim(),
    weddings: facts.weddings.trim() || undefined,
    years: facts.years.trim() || undefined,
    rating: facts.rating.trim() || undefined,
    strengths: facts.strengths,
    extra: facts.extra,
    speaker,
    angle,
    language: lang,
    tone,
    seconds,
    cta,
    offer,
    ...over,
  })

  const fail = (e: Error) => toast.error(e.message || 'The AI could not write just now. Try again.')

  function run() {
    write.mutate(ask(), {
      onSuccess: (r) => {
        const next = { scripts: r.scripts, seconds }
        setBatch(next)
        store(LAST_KEY, next)
      },
      onError: fail,
    })
  }

  function writeAgain(i: number, s: AdScript) {
    setAgain(i)
    // The other scripts' hooks go along, so this one opens differently (live test, 11 Nov).
    const others = (scripts ?? []).filter((_, j) => j !== i).map((x) => x.hook.slice(0, 160)).slice(0, 6)
    write.mutate(ask({ angle: s.angle, count: 1, seconds: batch?.seconds ?? seconds, avoid_hooks: [...others, s.hook.slice(0, 160)].slice(0, 6) }), {
      onSuccess: (r) => {
        const fresh = r.scripts[0]
        if (!fresh) return
        setBatch((b) => {
          if (!b) return b
          const next = { ...b, scripts: b.scripts.map((x, j) => (j === i ? fresh : x)) }
          store(LAST_KEY, next)
          return next
        })
        toast.success(`Script ${i + 1} written again.`)
      },
      onError: fail,
      onSettled: () => setAgain(null),
    })
  }

  function addStrength() {
    const word = adding.trim()
    if (!word) return
    if (!facts.strengths.includes(word)) set({ strengths: [...facts.strengths, word] })
    if (!STRENGTHS.includes(word) && !ownWords.includes(word)) keepWord.mutate(word)
    setAdding('')
  }

  const toggle = (w: string) =>
    set({ strengths: facts.strengths.includes(w) ? facts.strengths.filter((x) => x !== w) : [...facts.strengths, w].slice(0, 12) })

  const noName = !facts.studio.trim()
  const busy = write.isPending && again === null

  return (
    <AiTwoPane
      written={scripts}
      ask={
        <>
          <AiStep n={1} title="About your studio">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Studio name">
                <Input
                  value={facts.studio}
                  onChange={(e) => set({ studio: e.target.value })}
                  className={cn(noName ? 'border-amber-400 bg-amber-50/60' : 'border-success/60')}
                  maxLength={120}
                />
              </Field>
              <Field label="City">
                <Input value={facts.city} onChange={(e) => set({ city: e.target.value })} placeholder="e.g. Jaipur" maxLength={80} />
              </Field>
              <Field label="Weddings shot so far">
                <Input inputMode="numeric" value={facts.weddings} onChange={(e) => set({ weddings: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 500" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Years">
                  <Input inputMode="numeric" value={facts.years} onChange={(e) => set({ years: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 8" />
                </Field>
                <Field label="Google rating">
                  <Input inputMode="decimal" value={facts.rating} onChange={(e) => set({ rating: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 4.8" />
                </Field>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Leave a number blank and the script never says one.</p>
          </AiStep>

          <AiStep n={2} title="What makes you different?">
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-2">
                <Input
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addStrength()
                    }
                  }}
                  placeholder="Type your own, e.g. Shot 40 palace weddings"
                  maxLength={60}
                  aria-label="Add what makes you different"
                />
                <Button type="button" onClick={addStrength} disabled={!adding.trim()}>
                  <Plus /> Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {strengths.map((w) => (
                  <button key={w} type="button" aria-pressed={facts.strengths.includes(w)} className={aiChip(facts.strengths.includes(w))} onClick={() => toggle(w)}>
                    {facts.strengths.includes(w) && <Check className="size-3" aria-hidden />} {w}
                  </button>
                ))}
              </div>
              <p className={cn('text-xs', facts.strengths.length ? 'text-success' : 'text-amber-700 dark:text-amber-400')}>
                {facts.strengths.length ? `${facts.strengths.length} chosen` : 'Pick two or three -- the script is built on them'}
              </p>
              <textarea
                value={facts.extra}
                onChange={(e) => set({ extra: e.target.value })}
                rows={2}
                maxLength={400}
                placeholder="Anything else true about you (optional), e.g. we shot the Mehta family's three weddings"
                className="w-full rounded-md border border-input bg-background p-2.5 text-sm"
                aria-label="Anything else about your studio"
              />
            </div>
          </AiStep>

          <AiStep n={3} title="Who will speak?">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {SPEAKERS.map((s) => (
                <AiTile key={s.key} on={speaker === s.key} icon={s.icon} title={s.title} onClick={() => setSpeaker(s.key)} />
              ))}
            </div>
          </AiStep>

          <AiStep n={4} title="What kind of script?">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              {ANGLES.map((a) => (
                <AiTile key={a.key} on={angle === a.key} icon={a.icon} title={a.title} line={a.line} onClick={() => setAngle(a.key)} />
              ))}
            </div>
          </AiStep>

          <AiStep n={5} title="How should it sound?">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <AiChoice label="Language">
                  {(['hi', 'en', 'hinglish'] as const).filter((k) => AI_LANGS.includes(k)).map((k) => (
                    <button key={k} type="button" aria-pressed={lang === k} className={aiChip(lang === k)} onClick={() => setLang(k)}>
                      {LANG_NAMES[k]}
                    </button>
                  ))}
                </AiChoice>
                <AiChoice label="Length">
                  {AD_LENGTHS.map((n) => (
                    <button key={n} type="button" aria-pressed={seconds === n} className={aiChip(seconds === n)} onClick={() => setSeconds(n)}>
                      {n} s
                    </button>
                  ))}
                </AiChoice>
              </div>
              <AiChoice label="Tone">
                {AI_TONES.map((k) => (
                  <button key={k} type="button" aria-pressed={tone === k} className={aiChip(tone === k)} onClick={() => setTone(k)}>
                    {TONE_NAMES[k]}
                  </button>
                ))}
              </AiChoice>
              <AiChoice label="They should">
                {CTAS.map((c) => (
                  <button key={c.key} type="button" aria-pressed={cta === c.key} className={aiChip(cta === c.key)} onClick={() => setCta(c.key)}>
                    {c.label}
                  </button>
                ))}
              </AiChoice>
              <Input value={offer} onChange={(e) => setOffer(e.target.value)} maxLength={200} placeholder="An offer (optional), e.g. Free pre-wedding shoot on bookings before 31 Dec" aria-label="An offer" />
            </div>
          </AiStep>

          <Button size="lg" onClick={run} disabled={noName || write.isPending} className="w-full bg-violet-600 hover:bg-violet-700 sm:w-auto sm:self-start">
            {busy ? <Loader2 className="animate-spin" /> : scripts ? <RefreshCw /> : <Sparkles />}
            {busy ? 'Writing…' : scripts ? 'Create new scripts' : 'Create script'}
          </Button>
        </>
      }
      result={
        scripts && scripts.length > 0 && !busy ? (
          <section aria-label="Your scripts" className="flex flex-col gap-4">
            <p className="text-sm font-semibold">
              {scripts.length} script{scripts.length === 1 ? '' : 's'} · change any word, then hand it to your model
            </p>
            {scripts.map((s, i) => (
              <ScriptCard
                key={`${i}-${s.hook.slice(0, 24)}`}
                n={i + 1}
                script={s}
                target={batch?.seconds ?? seconds}
                rewriting={again === i}
                onAgain={() => writeAgain(i, s)}
                disabled={write.isPending}
              />
            ))}
          </section>
        ) : (
          <AiWaiting
            icon={Clapperboard}
            title={busy ? 'Writing your scripts…' : 'Your ad scripts will appear here'}
            lines={[
              'Three different angles, each under a minute, made to bring enquiries.',
              'A hook for the first 3 seconds, timed parts, on-screen lines and notes for the model.',
              'Only your own facts and numbers. Open it in the Teleprompter to shoot.',
            ]}
          />
        )
      }
    />
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

function ScriptCard({
  n,
  script,
  target,
  rewriting,
  disabled,
  onAgain,
}: {
  n: number
  script: AdScript
  target: number
  rewriting: boolean
  disabled: boolean
  onAgain: () => void
}) {
  const [hook, setHook] = useState(script.hook)
  const [parts, setParts] = useState(script.parts.map((p) => p.text))
  const [copied, setCopied] = useState(false)
  const [prompt, setPrompt] = useState(false)
  const lines = spokenText({ hook, parts: parts.map((text) => ({ text })) })
  const long = script.seconds > target + 3

  const full = [
    `${script.title} (${ANGLE_NAME[script.angle] ?? ''}) · about ${script.seconds} s`,
    '',
    `[0–3 s] ${hook}`,
    ...script.parts.map((p, i) => `${p.at ? `[${p.at}] ` : ''}${parts[i] ?? ''}`),
    script.on_screen.length ? `\nOn screen: ${script.on_screen.join(' | ')}` : '',
    script.model_notes ? `For the model: ${script.model_notes}` : '',
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .trim()

  async function copy() {
    try {
      await navigator.clipboard.writeText(full)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      toast.success(`Script ${n} copied.`)
    } catch {
      toast.error('Could not copy. Select the text and copy it.')
    }
  }

  return (
    <article className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-sm', rewriting && 'opacity-60')}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Script {n} · {ANGLE_NAME[script.angle]}
          </span>
          <span className="block truncate font-semibold">{script.title}</span>
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
            long ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-success/15 text-success',
          )}
          title={`${script.words} words`}
        >
          about {script.seconds} s{long ? ' · a little long' : ''}
        </span>
      </header>
      <div className="flex flex-col gap-3 p-3">
        <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900 dark:bg-violet-950/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">0–3 s · the hook</p>
          <textarea
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            rows={2}
            className="mt-1 w-full resize-y bg-transparent text-lg font-semibold leading-snug focus:outline-none"
            aria-label={`Hook of script ${n}`}
          />
        </div>
        {script.parts.map((p, i) => (
          <div key={i} className="flex gap-3">
            <span className="w-14 shrink-0 pt-1 text-xs font-medium tabular-nums text-muted-foreground">{p.at}</span>
            <textarea
              value={parts[i] ?? ''}
              onChange={(e) => setParts((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
              rows={Math.min(6, Math.max(2, Math.ceil((parts[i]?.length ?? 0) / 60)))}
              className="w-full resize-y rounded-md bg-transparent text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-violet-400"
              aria-label={`Script ${n}, ${p.at || `part ${i + 1}`}`}
            />
          </div>
        ))}
        {script.on_screen.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">On screen</p>
            <div className="flex flex-wrap gap-1.5">
              {script.on_screen.map((l) => (
                <span key={l} className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white dark:bg-slate-700">
                  {l}
                </span>
              ))}
            </div>
          </div>
        )}
        {script.model_notes && (
          <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">For the model: </span>
            {script.model_notes}
          </p>
        )}
      </div>
      <footer className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2.5">
        <Button size="sm" onClick={() => setPrompt(true)} className="bg-slate-900 text-white hover:bg-slate-800">
          <MonitorPlay /> Teleprompter
        </Button>
        <Button size="sm" variant={copied ? 'default' : 'outline'} onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(full)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> Send on WhatsApp
          </a>
        </Button>
        <Button size="sm" variant="outline" onClick={onAgain} disabled={disabled}>
          {rewriting ? <Loader2 className="animate-spin" /> : <RefreshCw />} Write again
        </Button>
      </footer>
      {prompt && <Teleprompter title={script.title} lines={lines} seconds={script.seconds} onClose={() => setPrompt(false)} />}
    </article>
  )
}
