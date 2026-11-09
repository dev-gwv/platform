import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Loader2, MessageCircle, RefreshCw, Send, Sparkles } from 'lucide-react'
import { AI_LANGS, AI_TONES, LEAD_REPLY_INTENTS, type AiLang, type AiTone, type LeadReplyIntent } from '@ipc/contracts'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { NewBadge } from '@/shared/ui/new-badge'
import { useReplySendDirect, useReplySent, useWriteReply } from './api'
import { INTENT_NAMES, LANG_NAMES, TONE_NAMES, defaultIntent, looksLike, waWithText } from './intents'

const LANG_KEY = 'ai-reply-lang'
const readLang = (): AiLang | null => {
  try {
    const v = window.localStorage.getItem(LANG_KEY)
    return (AI_LANGS as readonly string[]).includes(v ?? '') ? (v as AiLang) : null
  } catch {
    return null
  }
}
const keepLang = (l: AiLang) => {
  try {
    window.localStorage.setItem(LANG_KEY, l)
  } catch {
    /* a private window: the choice lasts this visit */
  }
}

/**
 * "Reply with AI" (owner, 9 Nov): the button beside WhatsApp on a lead. It
 * writes one WhatsApp reply from what is known about the lead, in the
 * language and tone picked, for the person to read, change and send. Nothing
 * goes out until they press a send button.
 */
export function ReplyWithAiButton(props: ReplyProps & { className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-violet-700',
          props.className,
        )}
        title="Write a WhatsApp reply with AI"
      >
        <Sparkles className="size-4" aria-hidden />
        {props.compact ? 'AI reply' : 'Reply with AI'}
        <NewBadge feature="aiReply" className="border-white/40 bg-white/20 text-white" />
      </button>
      {open && <ReplySheet {...props} onClose={() => setOpen(false)} />}
    </>
  )
}

interface ReplyProps {
  leadId: string
  name: string | null
  phone: string | null
  status: string | null
  contactedStatus?: string | null
  /** The client's last message, to suggest the language they write in. */
  lastClientMessage?: string | null
  /** A team member's own lead (My leads) rather than the CRM's. */
  mine?: boolean
}

export function ReplySheet({
  leadId,
  name,
  phone,
  status,
  contactedStatus,
  lastClientMessage,
  mine = false,
  onClose,
}: ReplyProps & { onClose: () => void }) {
  const suggested = looksLike(lastClientMessage)
  const [intent, setIntent] = useState<LeadReplyIntent>(() => defaultIntent({ status, contacted_status: contactedStatus }))
  const [lang, setLang] = useState<AiLang>(() => suggested ?? readLang() ?? 'en')
  const [tone, setTone] = useState<AiTone>('warm')
  const [hint, setHint] = useState('')
  const [text, setText] = useState('')
  const [direct, setDirect] = useState(false)
  const write = useWriteReply(leadId, mine)
  const sent = useReplySent(leadId, mine)
  const sendDirect = useReplySendDirect(leadId)
  const first = (name ?? '').trim().split(/\s+/)[0] || 'them'

  function run() {
    keepLang(lang)
    write.mutate(
      { intent, language: lang, tone, hint },
      {
        onSuccess: (r) => {
          setText(r.text)
          setDirect(!mine && r.can_send_direct)
        },
        onError: (e) => toast.error(e.message || 'The AI could not write just now. Try again.'),
      },
    )
  }

  function openWhatsApp() {
    const url = phone ? waWithText(phone, text) : null
    if (!url) return
    window.open(url, '_blank', 'noopener')
    sent.mutate({ text, via: 'whatsapp_link' })
    toast.success(`Opened in WhatsApp. Kept on ${first}'s timeline.`)
    onClose()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      sent.mutate({ text, via: 'copied' })
      toast.success('Copied. Paste it in WhatsApp.')
    } catch {
      toast.error('Could not copy. Select the text and copy it.')
    }
  }

  const chip = (on: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-sm transition-colors',
      on ? 'border-violet-600 bg-violet-600 text-white' : 'border-border bg-background hover:border-violet-400',
    )

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Reply to ${first} with AI`} className="max-w-xl">
        <div className="flex flex-col gap-4">
          <section aria-label="What is the reply for">
            <p className="mb-1.5 text-sm font-medium">What is it for?</p>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_REPLY_INTENTS.map((k) => (
                <button key={k} type="button" aria-pressed={intent === k} onClick={() => setIntent(k)} className={chip(intent === k)}>
                  {INTENT_NAMES[k]}
                </button>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <section aria-label="Language">
              <p className="mb-1.5 text-sm font-medium">Language</p>
              <div className="flex flex-wrap gap-1.5">
                {AI_LANGS.map((k) => (
                  <button key={k} type="button" aria-pressed={lang === k} onClick={() => setLang(k)} className={chip(lang === k)}>
                    {LANG_NAMES[k]}
                  </button>
                ))}
              </div>
              {suggested && suggested === lang && (
                <p className="mt-1 text-xs text-muted-foreground">They wrote in {LANG_NAMES[suggested]}.</p>
              )}
            </section>
            <section aria-label="Tone">
              <p className="mb-1.5 text-sm font-medium">Tone</p>
              <div className="flex flex-wrap gap-1.5">
                {AI_TONES.map((k) => (
                  <button key={k} type="button" aria-pressed={tone === k} onClick={() => setTone(k)} className={chip(tone === k)}>
                    {TONE_NAMES[k]}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {intent === 'custom' ? 'What should it say?' : 'Anything to mention? (optional)'}
            <input
              value={hint}
              maxLength={300}
              onChange={(e) => setHint(e.target.value)}
              placeholder={intent === 'custom' ? 'e.g. tell them we can do a drone shoot too' : 'e.g. we have one team free that day'}
              className={cn(
                'h-10 rounded-md border bg-background px-3 font-normal',
                intent === 'custom' && !hint.trim() ? 'border-amber-400 bg-amber-50/60' : 'border-input',
              )}
            />
          </label>

          {!text ? (
            <Button
              onClick={run}
              disabled={write.isPending || (intent === 'custom' && !hint.trim())}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {write.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {write.isPending ? 'Writing…' : 'Write reply'}
            </Button>
          ) : (
            <section aria-label="The reply" className="flex flex-col gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={Math.min(12, Math.max(5, text.split('\n').length + 1))}
                maxLength={4000}
                className="w-full rounded-md border border-violet-300 bg-violet-50/40 p-3 text-sm leading-relaxed focus:border-violet-500 focus:outline-none"
                aria-label="Reply, change anything before sending"
              />
              <div className="flex flex-wrap items-center gap-2">
                {phone ? (
                  <Button onClick={openWhatsApp} disabled={!text.trim()} className="bg-[#25D366] text-white hover:bg-[#1ebe5b]">
                    <MessageCircle /> Open WhatsApp
                  </Button>
                ) : (
                  <span className="rounded-md border border-dashed border-amber-400 px-2 py-1 text-xs text-amber-700">
                    Add their number to send it on WhatsApp
                  </span>
                )}
                {direct && (
                  <Button
                    variant="outline"
                    disabled={sendDirect.isPending || !text.trim()}
                    onClick={() =>
                      sendDirect.mutate(text, {
                        onSuccess: () => {
                          toast.success(`Sent to ${first} from your WhatsApp number.`)
                          onClose()
                        },
                        onError: (e) => toast.error(e.message),
                      })
                    }
                  >
                    <Send /> Send from your number
                  </Button>
                )}
                <Button variant="outline" onClick={() => void copy()} disabled={!text.trim()}>
                  <Copy /> Copy
                </Button>
                <Button variant="ghost" onClick={run} disabled={write.isPending} className="ml-auto">
                  {write.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Write again
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Read it before sending. Prices come only from your saved packages.
              </p>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
