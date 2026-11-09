import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  BellRing,
  CalendarHeart,
  Gift,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  PhoneCall,
  ReceiptIndianRupee,
  RefreshCw,
  Sparkles,
  Star,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import {
  AI_LANGS,
  AI_TONES,
  type AiLang,
  type AiTone,
  type SequenceDraftRequest,
  type SequenceGoal,
  type SequenceInput,
} from '@ipc/contracts'
import { fillSequenceText } from '@ipc/domain'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { useCompanyProfile } from '@/features/settings/api'
import { SequenceEditor } from '@/features/crm-sequences/SequenceEditor'
import { useHasFeature } from '@/features/crm-sequences/api'
import { useWriteSequence } from '@/features/crm-ai/api'
import { LANG_NAMES, TONE_NAMES } from '@/features/crm-ai/intents'

export function AiSequencesPage() {
  return (
    <AuthedPage module="crm">
      <PageHeader
        title="Follow-up sequence maker"
        actions={
          <Link
            to="/follow-ups/setup"
            search={{ section: 'sequences' } as never}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            Your sequences
          </Link>
        }
      />
      <SequenceMaker />
    </AuthedPage>
  )
}

const GOALS: { key: SequenceGoal; title: string; line: string; icon: LucideIcon }[] = [
  { key: 'new_no_reply', title: 'New enquiry, no reply', line: 'They asked, you wrote, they went silent.', icon: BellRing },
  { key: 'quote_quiet', title: 'Quotation sent, gone quiet', line: 'Bring them back to the quotation.', icon: ReceiptIndianRupee },
  { key: 'after_call', title: 'After the first call', line: 'Keep the warmth going until they decide.', icon: PhoneCall },
  { key: 'price_too_high', title: 'Price felt high', line: 'Show the value, offer options.', icon: Gift },
  { key: 'after_shoot', title: 'After the shoot', line: 'Thank you, a Google review, then referrals.', icon: Star },
  { key: 'win_back', title: 'Win back a lost lead', line: 'Keep the door open, kindly.', icon: CalendarHeart },
  { key: 'custom', title: 'Something else', line: 'Say what you want in a line.', icon: Wand2 },
]

const LENGTHS = [
  ['week', '1 week'],
  ['two_weeks', '2 weeks'],
  ['month', '1 month'],
] as const
const PACES = [
  ['gentle', 'Gentle'],
  ['normal', 'Normal'],
  ['persistent', 'Persistent'],
] as const
const CHANNELS = [
  ['whatsapp', 'WhatsApp only'],
  ['whatsapp_calls', 'WhatsApp + call reminders'],
  ['whatsapp_calls_email', 'WhatsApp, calls + email'],
] as const

const SAMPLE = { name: 'Riya Sharma', event_type: 'Wedding', event_date: '2027-02-14', city: 'Jaipur' }

const CHANNEL_ICON = { whatsapp: MessageCircle, reminder: Phone, email: Mail } as const
const CHANNEL_WORD = { whatsapp: 'WhatsApp', reminder: 'Call reminder', email: 'Email' } as const

const hourWords = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'am' : 'pm'}`

/**
 * The sequence maker (owner, 9 Nov): the studio says what happened with the
 * lead, the AI writes a whole follow-up sequence, and the studio checks every
 * word in the usual editor before saving. Nothing starts by itself.
 */
function SequenceMaker() {
  const write = useWriteSequence()
  const company = useCompanyProfile()
  const auto = useHasFeature('sequences_auto')
  const [goal, setGoal] = useState<SequenceGoal | null>(null)
  const [length, setLength] = useState<NonNullable<SequenceDraftRequest['length']>>('two_weeks')
  const [pace, setPace] = useState<NonNullable<SequenceDraftRequest['pace']>>('normal')
  const [channels, setChannels] = useState<NonNullable<SequenceDraftRequest['channels']>>('whatsapp_calls')
  const [lang, setLang] = useState<AiLang>('en')
  const [tone, setTone] = useState<AiTone>('warm')
  const [hint, setHint] = useState('')
  const [draft, setDraft] = useState<SequenceInput | null>(null)
  const [editing, setEditing] = useState(false)
  const studio = {
    name: company.data?.display_name || company.data?.name || 'Your studio',
    website: company.data?.website ?? null,
  }
  const needsHint = goal === 'custom' && !hint.trim()

  function run() {
    if (!goal) return
    write.mutate(
      { goal, length, pace, channels, language: lang, tone, hint },
      {
        onSuccess: (d) => setDraft(d),
        onError: (e) => toast.error(e.message || 'The AI could not write just now. Try again.'),
      },
    )
  }

  const chip = (on: boolean) =>
    cn(
      'rounded-full border px-3 py-1.5 text-sm transition-colors',
      on ? 'border-violet-600 bg-violet-600 text-white' : 'border-border bg-card hover:border-violet-400',
    )

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <section aria-label="What happened with the lead">
        <h2 className="mb-2 font-semibold">What happened with the lead?</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {GOALS.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={goal === g.key}
              onClick={() => {
                setGoal(g.key)
                setDraft(null)
              }}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                goal === g.key ? 'border-violet-600 bg-violet-50 ring-1 ring-violet-600' : 'border-border bg-card hover:border-violet-400',
                !goal && 'border-dashed border-amber-400',
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  goal === g.key ? 'bg-violet-600 text-white' : 'bg-muted text-muted-foreground',
                )}
              >
                <g.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{g.title}</span>
                <span className="block text-sm text-muted-foreground">{g.line}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {goal && (
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice label="How long">
                {LENGTHS.map(([k, w]) => (
                  <button key={k} type="button" aria-pressed={length === k} className={chip(length === k)} onClick={() => setLength(k)}>
                    {w}
                  </button>
                ))}
              </Choice>
              <Choice label="How often">
                {PACES.map(([k, w]) => (
                  <button key={k} type="button" aria-pressed={pace === k} className={chip(pace === k)} onClick={() => setPace(k)}>
                    {w}
                  </button>
                ))}
              </Choice>
              <Choice label="Messages">
                {CHANNELS.map(([k, w]) => (
                  <button key={k} type="button" aria-pressed={channels === k} className={chip(channels === k)} onClick={() => setChannels(k)}>
                    {w}
                  </button>
                ))}
              </Choice>
              <Choice label="Language and tone">
                {AI_LANGS.map((k) => (
                  <button key={k} type="button" aria-pressed={lang === k} className={chip(lang === k)} onClick={() => setLang(k)}>
                    {LANG_NAMES[k]}
                  </button>
                ))}
                <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
                {AI_TONES.map((k) => (
                  <button key={k} type="button" aria-pressed={tone === k} className={chip(tone === k)} onClick={() => setTone(k)}>
                    {TONE_NAMES[k]}
                  </button>
                ))}
              </Choice>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {goal === 'custom' ? 'What should the sequence do?' : 'Anything to mention? (optional)'}
              <input
                value={hint}
                maxLength={300}
                onChange={(e) => setHint(e.target.value)}
                placeholder={
                  goal === 'custom'
                    ? 'e.g. remind couples to book their pre-wedding shoot'
                    : 'e.g. 10% off pre-wedding if they book this month'
                }
                className={cn(
                  'h-10 rounded-md border bg-background px-3 font-normal',
                  needsHint ? 'border-amber-400 bg-amber-50/60' : 'border-input',
                )}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={run} disabled={write.isPending || needsHint} className="bg-violet-600 hover:bg-violet-700">
                {write.isPending ? <Loader2 className="animate-spin" /> : draft ? <RefreshCw /> : <Sparkles />}
                {write.isPending ? 'Writing…' : draft ? 'Write again' : 'Write my sequence'}
              </Button>
              <span className="text-xs text-muted-foreground">Prices and offers come only from what you write here.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {draft && (
        <section aria-label="Your sequence" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {draft.name} · {draft.steps.length} steps
            </h2>
            <Button onClick={() => setEditing(true)}>Use this sequence</Button>
          </div>
          <ol className="relative flex flex-col gap-2 border-l-2 border-violet-200 pl-4">
            {draft.steps.map((s, i) => {
              const Icon = CHANNEL_ICON[s.channel]
              const text = s.channel === 'reminder' ? (s.note ?? '') : fillSequenceText(s.body ?? '', SAMPLE, studio)
              return (
                <li key={i} className="relative">
                  <span className="absolute -left-[25px] top-3 size-3 rounded-full border-2 border-white bg-violet-600" aria-hidden />
                  <Card>
                    <CardContent className="p-3">
                      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Icon className="size-3.5" aria-hidden />
                        Day {s.day_offset} · {hourWords(s.send_hour ?? 10)} · {CHANNEL_WORD[s.channel]}
                      </p>
                      {s.channel === 'email' && s.subject && (
                        <p className="text-sm font-medium">{fillSequenceText(s.subject, SAMPLE, studio)}</p>
                      )}
                      <p className="whitespace-pre-line text-sm">{text}</p>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ol>
          <p className="text-xs text-muted-foreground">
            Shown for a sample couple, Riya. Messages wait in Send now for one tap each
            {auto ? ', or go from your own WhatsApp number when WhatsApp allows it' : ''}; a reply, a booking or a lost
            lead stops it. Nothing starts until you save it and add leads.
          </p>
        </section>
      )}

      {editing && draft && <SequenceEditor sequence={null} draft={draft} onClose={() => setEditing(false)} />}
    </div>
  )
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}
