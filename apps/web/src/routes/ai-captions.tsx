import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BadgePercent,
  CalendarCheck,
  Camera,
  Check,
  Clapperboard,
  Copy,
  Facebook,
  Heart,
  Instagram,
  Loader2,
  MessageCircle,
  Quote,
  RefreshCw,
  Smartphone,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import {
  AI_LANGS,
  AI_TONES,
  captionReply,
  projectDetail,
  shootListItem,
  type AiLang,
  type AiTone,
  type Caption,
  type CaptionKind,
  type CaptionPlatform,
  type CaptionRequest,
} from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { callApi } from '@/shared/api/client'
import { useCompanyProfile } from '@/features/settings/api'
import { ProjectPicker } from '@/features/projects/ProjectPicker'
import { LANG_NAMES, TONE_NAMES } from '@/features/crm-ai/intents'
import { AiChoice, AiStep, AiTile, AiTwoPane, AiWaiting, aiChip } from '@/features/ai/parts'

export function AiCaptionsPage() {
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <PageHeader title="Social media captions" />
      <CaptionMaker />
    </AuthedPage>
  )
}

const PLATFORMS: { key: CaptionPlatform; label: string; icon: LucideIcon }[] = [
  { key: 'instagram', label: 'Instagram', icon: Instagram },
  { key: 'facebook', label: 'Facebook', icon: Facebook },
  { key: 'whatsapp_status', label: 'WhatsApp status', icon: Smartphone },
]

const KINDS: { key: CaptionKind; title: string; icon: LucideIcon }[] = [
  { key: 'wedding_post', title: 'Wedding photos', icon: Heart },
  { key: 'pre_wedding', title: 'Pre-wedding shoot', icon: Camera },
  { key: 'reel', title: 'Reel or film', icon: Clapperboard },
  { key: 'behind_the_scenes', title: 'Behind the scenes', icon: Sparkles },
  { key: 'testimonial', title: "A couple's kind words", icon: Quote },
  { key: 'offer', title: 'An offer', icon: BadgePercent },
  { key: 'dates_open', title: 'Dates open for booking', icon: CalendarCheck },
  { key: 'custom', title: 'Something else', icon: Wand2 },
]

const PLACEHOLDER: Record<CaptionKind, string> = {
  wedding_post: 'e.g. Priya & Rahul, a palace wedding in Udaipur. The pheras at sunset, her grandmother crying with joy.',
  pre_wedding: 'e.g. Ananya & Kabir, a misty morning in Munnar, tea gardens, a vintage scooter.',
  reel: 'e.g. A 60-second film of Meera & Arjun’s sangeet, the whole family dancing.',
  behind_the_scenes: 'e.g. Our team at 4 am setting up drones for a beach wedding in Goa.',
  testimonial: 'e.g. “You captured moments we didn’t even know happened.” – Sneha & Vikram',
  offer: 'e.g. Book a wedding before 31 Dec and get the pre-wedding shoot free.',
  dates_open: 'e.g. A few dates left for Feb–March 2027 weddings in Rajasthan.',
  custom: 'Say what the post is about.',
}

/**
 * Social media captions (owner, 10 Nov): pick the post, say what is in it in
 * a line (or fill it from a project), and three captions come back to copy,
 * each with its hashtags. Nothing is posted from here.
 */
function CaptionMaker() {
  const company = useCompanyProfile()
  const [platform, setPlatform] = useState<CaptionPlatform>('instagram')
  const [kind, setKind] = useState<CaptionKind | null>(null)
  const [details, setDetails] = useState('')
  const [lang, setLang] = useState<AiLang>('en')
  const [tone, setTone] = useState<AiTone>('warm')
  const [hashtags, setHashtags] = useState(true)
  const [emojis, setEmojis] = useState(true)
  const [projectId, setProjectId] = useState('')
  const [projectName, setProjectName] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  const write = useMutation({
    mutationFn: (body: CaptionRequest) =>
      callApi('/designs/captions', { method: 'POST', body, responseSchema: captionReply }),
  })
  const studio = company.data?.display_name || company.data?.name || ''
  const city = company.data?.city ?? ''
  const needsDetails = kind === 'custom' && !details.trim()

  async function fromProject(id: string, name: string | null) {
    setProjectId(id)
    setProjectName(name)
    if (!id) return
    setFilling(true)
    try {
      const [p, shoots] = await Promise.all([
        callApi(`/projects/${id}`, { responseSchema: projectDetail }),
        callApi(`/shoots?project_id=${id}`, { responseSchema: shootListItem.array() }),
      ])
      const events = [...new Set(shoots.map((s) => s.name).filter(Boolean))].slice(0, 6)
      const places = [...new Set(shoots.map((s) => s.location).filter((x): x is string => !!x))].slice(0, 2)
      setDetails(
        [p.client_name && p.client_name !== p.name ? `${p.name} (${p.client_name})` : p.name, events.join(', '), places.join(' · ')]
          .filter(Boolean)
          .join(' · '),
      )
      if (!kind) setKind('wedding_post')
    } catch {
      toast.error('Could not read that project. Type the details instead.')
    } finally {
      setFilling(false)
    }
  }

  function run() {
    if (!kind) return
    write.mutate(
      { platform, kind, details, studio, city, language: lang, tone, hashtags, emojis },
      { onError: (e) => toast.error(e.message || 'The AI could not write just now. Try again.') },
    )
  }

  return (
    <AiTwoPane
      written={write.data}
      ask={
        <>
          <AiStep n={1} title="Where will you post it?">
            <div className="grid grid-cols-3 gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={platform === p.key}
                  onClick={() => setPlatform(p.key)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors',
                    platform === p.key ? 'border-violet-600 bg-violet-50 text-violet-700 ring-1 ring-violet-600 dark:bg-violet-950/40 dark:text-violet-300' : 'border-border hover:border-violet-400',
                  )}
                >
                  <p.icon className="size-5" aria-hidden />
                  {p.label}
                </button>
              ))}
            </div>
          </AiStep>

          <AiStep n={2} title="What is the post?">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {KINDS.map((k) => (
                <AiTile key={k.key} on={kind === k.key} icon={k.icon} title={k.title} onClick={() => setKind(k.key)} nudge={!kind} />
              ))}
            </div>
          </AiStep>

          <AiStep n={3} title="What is in it?">
            <div className="flex flex-col gap-3">
              <ProjectPicker
                value={projectId}
                label={projectName}
                noneLabel="No project"
                placeholder="Fill it from a project (optional)"
                onChange={(id, name) => void fromProject(id, name)}
                aria-label="Fill from a project"
              />
              <textarea
                value={details}
                maxLength={600}
                rows={4}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={kind ? PLACEHOLDER[kind] : 'The couple, the place, the moment, the offer -- a line or two.'}
                className={cn(
                  'w-full rounded-md border bg-background p-3 text-sm',
                  needsDetails ? 'border-amber-400 bg-amber-50/60' : details.trim() ? 'border-success/60' : 'border-input',
                )}
                aria-label="What is in the post"
              />
              {filling && <p className="text-xs text-muted-foreground">Reading the project…</p>}
            </div>
          </AiStep>

          <AiStep n={4} title="How should it sound?">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <AiChoice label="Language">
                  {AI_LANGS.map((k) => (
                    <button key={k} type="button" aria-pressed={lang === k} className={aiChip(lang === k)} onClick={() => setLang(k)}>
                      {LANG_NAMES[k]}
                    </button>
                  ))}
                </AiChoice>
                <AiChoice label="Tone">
                  {AI_TONES.map((k) => (
                    <button key={k} type="button" aria-pressed={tone === k} className={aiChip(tone === k)} onClick={() => setTone(k)}>
                      {TONE_NAMES[k]}
                    </button>
                  ))}
                </AiChoice>
              </div>
              <AiChoice label="Add">
                <button type="button" aria-pressed={hashtags} className={aiChip(hashtags)} onClick={() => setHashtags((v) => !v)} disabled={platform === 'whatsapp_status'}>
                  # Hashtags
                </button>
                <button type="button" aria-pressed={emojis} className={aiChip(emojis)} onClick={() => setEmojis((v) => !v)}>
                  😊 Emojis
                </button>
              </AiChoice>
            </div>
          </AiStep>

          <Button
            size="lg"
            onClick={run}
            disabled={!kind || write.isPending || needsDetails}
            className="w-full bg-violet-600 hover:bg-violet-700 sm:w-auto sm:self-start"
          >
            {write.isPending ? <Loader2 className="animate-spin" /> : write.data ? <RefreshCw /> : <Sparkles />}
            {write.isPending ? 'Writing…' : write.data ? 'Write three more' : 'Write my captions'}
          </Button>
        </>
      }
      result={
        write.data ? (
          <Results captions={write.data.captions} platform={platform} />
        ) : (
          <AiWaiting
            icon={Instagram}
            title={write.isPending ? 'Writing three captions…' : 'Three captions will appear here'}
            lines={[
              'Each one different, ready to copy with its hashtags.',
              'In English, हिन्दी or Hinglish, in your tone.',
              'Names, prices and places only from what you write.',
            ]}
          />
        )
      }
    />
  )
}

function Results({ captions, platform }: { captions: Caption[]; platform: CaptionPlatform }) {
  return (
    <section aria-label="Your captions" className="flex flex-col gap-3">
      <p className="text-sm font-semibold">
        {captions.length} caption{captions.length === 1 ? '' : 's'} · pick one, change anything, copy
      </p>
      {captions.map((c, i) => (
        <CaptionCard key={`${i}-${c.text.slice(0, 20)}`} n={i + 1} caption={c} platform={platform} />
      ))}
    </section>
  )
}

function CaptionCard({ n, caption, platform }: { n: number; caption: Caption; platform: CaptionPlatform }) {
  const [text, setText] = useState(caption.text)
  const [tags, setTags] = useState(caption.hashtags.join(' '))
  const [copied, setCopied] = useState(false)
  const full = [text.trim(), tags.trim()].filter(Boolean).join('\n\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(full)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      toast.success(`Caption ${n} copied. Paste it in ${platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : 'your status'}.`)
    } catch {
      toast.error('Could not copy. Select the text and copy it.')
    }
  }

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption {n}</span>
        <div className="flex gap-1.5">
          <Button size="sm" variant={copied ? 'default' : 'outline'} onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
          </Button>
          {platform === 'whatsapp_status' && (
            <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" asChild>
              <a href={`https://wa.me/?text=${encodeURIComponent(full)}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle /> WhatsApp
              </a>
            </Button>
          )}
        </div>
      </header>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
        className="w-full resize-y bg-transparent p-3 text-sm leading-relaxed focus:outline-none"
        aria-label={`Caption ${n}, change anything`}
      />
      {(tags || caption.hashtags.length > 0) && (
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full border-t border-border bg-transparent px-3 py-2 text-sm text-violet-700 focus:outline-none dark:text-violet-300"
          aria-label={`Hashtags for caption ${n}`}
        />
      )}
    </article>
  )
}
