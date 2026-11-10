import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  BellRing,
  CalendarHeart,
  Gift,
  ListChecks,
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
import { cn } from '@/shared/ui/cn'
import { useCompanyProfile } from '@/features/settings/api'
import { SequenceEditor } from '@/features/crm-sequences/SequenceEditor'
import { useHasFeature } from '@/features/crm-sequences/api'
import { useWriteSequence } from '@/features/crm-ai/api'
import { LANG_NAMES, TONE_NAMES } from '@/features/crm-ai/intents'
import { AiChoice, AiStep, AiTile, AiTwoPane, AiWaiting, aiChip } from '@/features/ai/parts'

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

  return (
    <>
      <AiTwoPane
        written={draft}
        ask={
          <>
            <AiStep n={1} title="What happened with the lead?">
              <div className="grid gap-2 sm:grid-cols-2">
                {GOALS.map((g) => (
                  <AiTile
                    key={g.key}
                    on={goal === g.key}
                    icon={g.icon}
                    title={g.title}
                    line={g.line}
                    nudge={!goal}
                    onClick={() => {
                      setGoal(g.key)
                      setDraft(null)
                    }}
                  />
                ))}
              </div>
            </AiStep>

            <AiStep n={2} title="How should it run?" className={cn(!goal && 'opacity-60')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <AiChoice label="How long">
                  {LENGTHS.map(([k, w]) => (
                    <button key={k} type="button" aria-pressed={length === k} className={aiChip(length === k)} onClick={() => setLength(k)}>
                      {w}
                    </button>
                  ))}
                </AiChoice>
                <AiChoice label="How often">
                  {PACES.map(([k, w]) => (
                    <button key={k} type="button" aria-pressed={pace === k} className={aiChip(pace === k)} onClick={() => setPace(k)}>
                      {w}
                    </button>
                  ))}
                </AiChoice>
                <div className="sm:col-span-2">
                  <AiChoice label="Messages">
                    {CHANNELS.map(([k, w]) => (
                      <button key={k} type="button" aria-pressed={channels === k} className={aiChip(channels === k)} onClick={() => setChannels(k)}>
                        {w}
                      </button>
                    ))}
                  </AiChoice>
                </div>
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
            </AiStep>

            <AiStep n={3} title={goal === 'custom' ? 'What should the sequence do?' : 'Anything to mention?'} className={cn(!goal && 'opacity-60')}>
              <input
                value={hint}
                maxLength={300}
                onChange={(e) => setHint(e.target.value)}
                aria-label={goal === 'custom' ? 'What should the sequence do' : 'Anything to mention (optional)'}
                placeholder={
                  goal === 'custom'
                    ? 'e.g. remind couples to book their pre-wedding shoot'
                    : 'Optional, e.g. 10% off pre-wedding if they book this month'
                }
                className={cn(
                  'h-10 w-full rounded-md border bg-background px-3 text-sm',
                  needsHint ? 'border-amber-400 bg-amber-50/60' : 'border-input',
                )}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">Prices and offers come only from what you write here.</p>
            </AiStep>

            <Button
              size="lg"
              onClick={run}
              disabled={!goal || write.isPending || needsHint}
              className="w-full bg-violet-600 hover:bg-violet-700 sm:w-auto sm:self-start"
            >
              {write.isPending ? <Loader2 className="animate-spin" /> : draft ? <RefreshCw /> : <Sparkles />}
              {write.isPending ? 'Writing…' : draft ? 'Write again' : 'Write my sequence'}
            </Button>
          </>
        }
        result={
          draft ? (
            <section aria-label="Your sequence" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{draft.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {draft.steps.length} steps · over {Math.max(...draft.steps.map((s) => s.day_offset), 0)} days · shown for a sample couple, Riya
                  </p>
                </div>
                <Button onClick={() => setEditing(true)}>Use this sequence</Button>
              </div>
              <ol className="relative flex max-h-[68vh] flex-col gap-2 overflow-y-auto border-l-2 border-violet-200 pl-4 pr-1">
                {draft.steps.map((s, i) => {
                  const Icon = CHANNEL_ICON[s.channel]
                  const text = s.channel === 'reminder' ? (s.note ?? '') : fillSequenceText(s.body ?? '', SAMPLE, studio)
                  return (
                    <li key={i} className="relative">
                      <span className="absolute -left-[25px] top-3 size-3 rounded-full border-2 border-white bg-violet-600" aria-hidden />
                      <div className="rounded-lg border border-border bg-background p-3">
                        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Icon className="size-3.5" aria-hidden />
                          Day {s.day_offset} · {hourWords(s.send_hour ?? 10)} · {CHANNEL_WORD[s.channel]}
                        </p>
                        {s.channel === 'email' && s.subject && (
                          <p className="text-sm font-medium">{fillSequenceText(s.subject, SAMPLE, studio)}</p>
                        )}
                        <p className="whitespace-pre-line text-sm">{text}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
              <p className="text-xs text-muted-foreground">
                Messages wait in Send now for one tap each
                {auto ? ', or go from your own WhatsApp number when WhatsApp allows it' : ''}; a reply, a booking or a lost
                lead stops it. Nothing starts until you save it and add leads.
              </p>
            </section>
          ) : (
            <AiWaiting
              icon={ListChecks}
              title={write.isPending ? 'Writing your sequence…' : 'Your sequence will appear here'}
              lines={[
                'Every message on its day and hour, WhatsApp, calls and email.',
                'Read it for a sample couple before you use it.',
                'Nothing is saved or sent until you press Use this sequence and save.',
              ]}
            />
          )
        }
      />
      {editing && draft && <SequenceEditor sequence={null} draft={draft} onClose={() => setEditing(false)} />}
    </>
  )
}

