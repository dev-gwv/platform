import { useEffect, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, Bug, CheckCircle2, Copy, ExternalLink, Eye, Keyboard, MessageCircle, RefreshCw, Send, Sparkles } from 'lucide-react'
import {
  SUPPORT_TICKET_KIND_LABEL,
  SUPPORT_TICKET_KINDS,
  SUPPORT_TICKET_STATUS_LABEL,
  SUPPORT_TICKET_WATCH_LABEL,
  type SupportTicket,
  type SupportTicketStatus,
} from '@ipc/contracts'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { VoiceNoteRecorder } from '@/features/projects/VoiceNoteRecorder'
import {
  callWhen,
  dueWords,
  STATUS_TONE,
  useFollowupDraft,
  useFollowupSend,
  useIssueOpened,
  useSupportTicket,
  useTicketBrief,
  useTicketNote,
  useTicketVoice,
  useUpdateTicket,
  waLink,
} from '@/features/support/tickets'

/**
 * One support ticket (0300). The group's brief and "how did it go?" posts link
 * here. The owner's whole job on this page is one voice note after the call;
 * the assistant fills in the rest, and every part of it can be changed.
 */
export function PlatformSupportTicketPage() {
  return (
    <PlatformPage>
      <TicketScreen />
    </PlatformPage>
  )
}

function TicketScreen() {
  const { id } = useParams({ from: '/authed/platform/support-calls/tickets/$id' })
  const q = useSupportTicket(id)
  if (q.isLoading) return <SkeletonList rows={4} />
  if (q.isError || !q.data) return <ErrorState message="Couldn’t load this ticket" onRetry={() => void q.refetch()} />
  return <Loaded t={q.data} />
}

const MOVES: SupportTicketStatus[] = ['open', 'waiting_us', 'waiting_them', 'solved']

function Loaded({ t }: { t: SupportTicket }) {
  const update = useUpdateTicket(t.id)
  const past = Date.parse(t.starts_at) <= Date.now()
  const noted = !!t.transcript

  return (
    <>
      <Link to="/platform/support-calls" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Support calls
      </Link>
      <PageHeader
        title={`${t.name}${t.studio_name ? ` · ${t.studio_name}` : ''}`}
        description={[callWhen(t.starts_at), t.email].filter(Boolean).join(' · ')}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={STATUS_TONE[t.status]}>{SUPPORT_TICKET_STATUS_LABEL[t.status]}</StatusBadge>
            {t.meeting_url && !past && (
              <Button asChild size="sm">
                <a href={t.meeting_url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Join the call
                </a>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        {/* After the call, the one thing to do comes first. */}
        {past && t.status !== 'cancelled' && <NoteCard t={t} />}

        {noted && (
          <Card>
            <CardContent className="flex flex-col gap-4 p-4">
              <h2 className="font-semibold">What happened</h2>
              <Saving value={t.summary ?? ''} label="Summary" long onSave={(v) => update.mutate({ summary: v || null })} />
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Type of call</span>
                <div className="flex flex-wrap gap-1.5">
                  {SUPPORT_TICKET_KINDS.map((k) => (
                    <Chip key={k} on={t.kind === k} onClick={() => update.mutate({ kind: k })}>
                      {SUPPORT_TICKET_KIND_LABEL[k]}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Where it stands</span>
                <div className="flex flex-wrap gap-1.5">
                  {MOVES.map((s) => (
                    <Chip key={s} on={t.status === s} tone={s === 'solved' ? 'green' : 'amber'} onClick={() => update.mutate({ status: s })}>
                      {SUPPORT_TICKET_STATUS_LABEL[s]}
                    </Chip>
                  ))}
                </div>
              </div>
              {t.status !== 'solved' && (
                <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                  <Saving value={t.next_action ?? ''} label="Next step" onSave={(v) => update.mutate({ next_action: v || null })} />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">
                      By {dueWords(t.due_on) && <span className={cn('font-normal', dueWords(t.due_on)!.includes('late') ? 'text-destructive' : 'text-muted-foreground')}>· {dueWords(t.due_on)}</span>}
                    </span>
                    <Input type="date" value={t.due_on ?? ''} onChange={(e) => update.mutate({ due_on: e.target.value || null })} />
                  </label>
                </div>
              )}
              {t.status !== 'solved' && t.watch && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Eye className="size-4 text-primary" /> Closes by itself once they {SUPPORT_TICKET_WATCH_LABEL[t.watch]}.
                </p>
              )}
              {t.status === 'solved' && t.closed_by === 'assistant' && (
                <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                  <CheckCircle2 className="size-4" /> Closed by itself: their data shows they did it after the call.
                </p>
              )}
              {t.status !== 'solved' && (
                <Button className="self-start" variant="outline" onClick={() => update.mutate({ status: 'solved' })}>
                  Mark solved
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {noted && t.status !== 'cancelled' && <FollowupCard t={t} />}
        {t.kind === 'bug' && t.issue_url && <IssueCard t={t} />}

        <BriefCard t={t} />

        {t.booking_notes && (
          <Card>
            <CardContent className="p-4">
              <h2 className="mb-1 font-semibold">What they wrote when booking</h2>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{t.booking_notes}</p>
            </CardContent>
          </Card>
        )}

        {noted && (
          <details className="rounded-xl border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">Your notes, word for word</summary>
            <p className="mt-2 whitespace-pre-line text-muted-foreground">{t.transcript}</p>
          </details>
        )}
      </div>
    </>
  )
}

/** Speak (or type) after the call; the assistant reads it into the ticket. */
function NoteCard({ t }: { t: SupportTicket }) {
  const voice = useTicketVoice(t.id)
  const note = useTicketNote(t.id)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const busy = voice.isPending || note.isPending
  const first = !t.transcript
  return (
    <Card className={cn(first && 'border-warning/50 bg-warning/5')}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="font-semibold">{first ? 'How did the call go?' : 'Add to the notes'}</h2>
          <p className="text-sm text-muted-foreground">
            {first
              ? 'Say it in a voice note, in Hindi or English: what they asked, what you did, what is left. The ticket fills itself.'
              : 'Anything that happened since. The summary and next step are written again from all of it.'}
          </p>
        </div>
        {busy ? (
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="size-4 animate-pulse" /> {voice.isPending ? 'Listening to your note and filling in the ticket…' : 'Filling in the ticket…'}
          </p>
        ) : typing ? (
          <div className="flex flex-col gap-2">
            <Textarea rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="They could not add the haldi. Showed them Event days. Send the invoice video tomorrow." />
            <div className="flex gap-2">
              <Button disabled={text.trim().length < 3} onClick={() => note.mutate(text, { onSuccess: () => { setText(''); setTyping(false) } })}>
                Fill in the ticket
              </Button>
              <Button variant="ghost" onClick={() => setTyping(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <VoiceNoteRecorder sending={voice.isPending} sendLabel="Fill in the ticket" onSend={(blob) => voice.mutateAsync(blob)} />
            <button type="button" onClick={() => setTyping(true)} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium hover:bg-muted">
              <Keyboard className="size-4" /> Type it instead
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The message to the studio after the call (0301): the assistant drafts it in
 * the call's language with the right tutorial links; you read it, change it if
 * you like, and send it. From your own WhatsApp today; from the official
 * number once the WhatsApp API is connected.
 */
function FollowupCard({ t }: { t: SupportTicket }) {
  const draft = useFollowupDraft(t.id)
  const send = useFollowupSend(t.id)
  const [text, setText] = useState(t.followup ?? '')
  useEffect(() => {
    setText(t.followup ?? '')
  }, [t.followup])
  const sent = !!t.followup_sent_at
  const via = t.followup_via === 'official' ? 'from the official number' : t.followup_via === 'copied' ? 'copied' : 'from your WhatsApp'

  return (
    <Card className={cn(!sent && t.followup && 'border-warning/50')}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Message to {t.name.includes('@') ? 'the studio' : t.name.split(/\s+/)[0]}</h2>
          {sent && (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4" /> Sent {via} · {callWhen(t.followup_sent_at!)}
            </span>
          )}
        </div>
        {!t.followup && !draft.isPending ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => draft.mutate(undefined)} className="bg-violet-600 text-white hover:bg-violet-700">
              <Sparkles /> Write the follow-up for me
            </Button>
            <span className="text-sm text-muted-foreground">A thank-you, what was done, what is next, and the right how-to videos.</span>
          </div>
        ) : draft.isPending ? (
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="size-4 animate-pulse" /> Writing the message…
          </p>
        ) : (
          <>
            <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              {t.official_ready && t.contact_phone && (
                <Button disabled={send.isPending || text.trim().length < 5} onClick={() => send.mutate({ text, via: 'official' })}>
                  <Send /> Send from our number
                </Button>
              )}
              <Button
                variant={t.official_ready && t.contact_phone ? 'outline' : 'default'}
                className={cn(!(t.official_ready && t.contact_phone) && 'bg-green-600 text-white hover:bg-green-700')}
                disabled={send.isPending || text.trim().length < 5}
                onClick={() => {
                  window.open(waLink(t.contact_phone, text), '_blank', 'noopener')
                  send.mutate({ text, via: 'whatsapp_link' })
                }}
              >
                <MessageCircle /> {t.contact_phone ? 'Send on WhatsApp' : 'Pick the chat on WhatsApp'}
              </Button>
              <Button
                variant="ghost"
                disabled={send.isPending}
                onClick={() => {
                  void navigator.clipboard.writeText(text).then(() => send.mutate({ text, via: 'copied' }))
                }}
              >
                <Copy /> Copy
              </Button>
              <Button variant="ghost" disabled={draft.isPending} onClick={() => draft.mutate(undefined)}>
                <RefreshCw /> Write it again
              </Button>
            </div>
            {!t.contact_phone && <p className="text-xs text-muted-foreground">No WhatsApp number on the booking or the studio, so WhatsApp will ask who to send it to.</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** A bug becomes a GitHub issue in one tap, filled in from the ticket (0301). Never their phone or email. */
function IssueCard({ t }: { t: SupportTicket }) {
  const opened = useIssueOpened(t.id)
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="font-semibold">Bug for the code</h2>
          <p className="text-sm text-muted-foreground">
            {t.issue_opened_at ? `Issue opened ${callWhen(t.issue_opened_at)}.` : 'Open a GitHub issue with the studio, what happened and a link back here.'}
          </p>
        </div>
        <Button
          variant={t.issue_opened_at ? 'outline' : 'default'}
          onClick={() => {
            window.open(t.issue_url!, '_blank', 'noopener')
            opened.mutate(undefined)
          }}
        >
          <Bug /> {t.issue_opened_at ? 'Open another issue' : 'Create GitHub issue'}
        </Button>
      </CardContent>
    </Card>
  )
}

function BriefCard({ t }: { t: SupportTicket }) {
  const brief = useTicketBrief(t.id)
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Brief before the call</h2>
          <Button size="sm" variant="outline" disabled={brief.isPending} onClick={() => brief.mutate(undefined)}>
            <RefreshCw className={cn(brief.isPending && 'animate-spin')} /> {t.brief ? 'Write it again' : 'Write it now'}
          </Button>
        </div>
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {t.brief ?? 'It is written from their studio’s data and posted in your support group an hour before the call.'}
        </p>
      </CardContent>
    </Card>
  )
}

/** A text that saves when you leave the box, so there is no Save to press. */
function Saving({ value, label, long, onSave }: { value: string; label: string; long?: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => {
    setV(value)
  }, [value])
  const save = () => {
    if (v.trim() !== value.trim()) onSave(v.trim())
  }
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {long ? (
        <Textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} onBlur={save} />
      ) : (
        <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} className={cn(!v && 'border-warning/60 bg-warning/5')} />
      )}
    </label>
  )
}

function Chip({ on, tone = 'primary', onClick, children }: { on: boolean; tone?: 'primary' | 'green' | 'amber'; onClick: () => void; children: React.ReactNode }) {
  const onClass = tone === 'green' ? 'border-success bg-success/15 text-success' : tone === 'amber' ? 'border-warning bg-warning/15 text-warning' : 'border-primary bg-primary/10 text-primary'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn('rounded-full border px-3 py-1.5 text-sm font-medium transition-colors', on ? onClass : 'border-border bg-background hover:bg-muted')}
    >
      {children}
    </button>
  )
}
