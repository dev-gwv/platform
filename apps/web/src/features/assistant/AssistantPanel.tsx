import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Copy,
  CornerDownLeft,
  Play,
  RotateCw,
  Send,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import type { AssistantTurn } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useTutorials } from '@/features/help/api'
import { TutorialPlayer } from '@/features/help/TutorialPlayer'
import { lengthLabel, type Tutorial } from '@/features/help/tutorials'
import { RichText } from './rich-text'
import { useAssistantFeedback, useAssistantQuotaRefresh } from './api'
import { askAssistant, stopAsking } from './send'
import {
  addSaid,
  dropLastSaid,
  lastQuestion,
  markHelpful,
  setDraft,
  snapshot,
  subscribe,
  type Said,
} from './thread'

/**
 * The help assistant's conversation.
 *
 * The exchange lives in `thread.ts`, at module scope, so closing the panel or
 * walking to another page does not take it -- following the link in an answer
 * used to destroy the conversation that produced it. Nothing is written to
 * storage: gone on reload is the intended lifetime.
 *
 * No streaming. Nothing in this app streams -- every call goes through
 * callApi, which owns token rotation and the correlation id -- and a help
 * answer arrives whole in a second or two, which is the better trade. What that
 * costs is the sense of progress a stream gives for free, so the waiting state
 * and Stop are doing that work instead.
 */

/** Sent back with each question. Enough for a follow-up, not enough to crowd the prompt. */
const CARRY = 6

/** The question box's own cap, matching the contract. */
const MAX_Q = 500

/** The contract's floor. Below it the request would be refused anyway. */
const MIN_Q = 3

/** Real questions, not a blank box: a blank box asks nothing of anybody. */
const OPENERS = [
  'How do I add my team?',
  'How do I send a quotation?',
  'How do I book crew for a shoot day?',
  'How do I give someone access to money?',
]

export function AssistantPanel({ callUrl, left }: { callUrl: string | null; left: number }) {
  const { said, draft, pending } = useSyncExternalStore(subscribe, snapshot, snapshot)
  const refreshQuota = useAssistantQuotaRefresh()
  const thread = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const [playing, setPlaying] = useState<Tutorial | null>(null)
  // One list for the panel: Bubble is drawn once per message, and this would
  // otherwise be a hook call per message.
  const tutorials = useTutorials()

  /**
   * Follow the conversation down, but only when they are already at the
   * bottom. Yanking the view while someone is reading an earlier answer is
   * worse than not scrolling at all.
   */
  useEffect(() => {
    const el = thread.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (atBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [said, pending])

  // Grow the box with the question instead of making them scroll inside one line.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [draft])

  const spent = left <= 0

  function send(question: string) {
    const q = question.trim()
    // The contract wants at least three characters. Stopping here rather than
    // letting the client-side parse throw: it used to put a page of Zod issues
    // in the chat bubble, which is a strange thing for a help assistant to say
    // to somebody who typed "hi".
    if (q.length < MIN_Q || pending || spent) return

    // The history is what was on screen BEFORE this question, which is why it
    // is taken here rather than inside the request.
    const history: AssistantTurn[] = said.slice(-CARRY).map((t) => ({ role: t.role, content: t.text }))
    addSaid({ role: 'user', text: q })
    setDraft('')
    // Picking an opener unmounts the button that had focus, which drops it to
    // the body; put it where the next question goes.
    box.current?.focus()

    void askAssistant({ question: q, history }, { callUrl, onSettled: refreshQuota })
  }

  /** Ask the same thing again, in place of the failure. */
  function retry() {
    const q = lastQuestion()
    if (!q) return
    // Take back the failure and the question under it, so the thread reads as
    // one exchange rather than a growing pile of the same question.
    if (said[said.length - 1]?.role === 'assistant') dropLastSaid()
    dropLastSaid()
    send(q)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter makes a new line: a question is one line far
    // more often than it is two.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(draft)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(draft)
  }

  const last = said[said.length - 1]
  const broke = last?.broke === true
  // After a Stop the last turn is the question itself, with no answer under it.
  const unanswered = last?.role === 'user'
  const near = draft.length > MAX_Q - 100
  const canSend = draft.trim().length >= MIN_Q

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={thread} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {said.length === 0 ? (
          <Opening onPick={send} />
        ) : (
          <div className="flex flex-col gap-3">
            {said.map((s, i) => (
              <Bubble key={i} said={s} at={i} tutorials={tutorials} onWatch={setPlaying} />
            ))}

            {/* So a screen reader hears the answer arrive rather than having to
                go looking for it. */}
            <div aria-live="polite" className="sr-only">
              {pending ? 'Looking it up' : last?.role === 'assistant' ? last.text : ''}
            </div>

            {pending && <Thinking />}

            {(broke || unanswered) && !pending && (
              <Button variant="outline" size="sm" className="self-start" onClick={retry}>
                <RotateCw /> Try again
              </Button>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={box}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_Q))}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={MAX_Q}
              disabled={spent}
              aria-label="Your question"
              placeholder={spent ? 'You have used today’s questions.' : 'Ask about anything in the app…'}
              className={cn(
                // Every control looks like a control: a real border, amber while
                // it is empty and waiting, calm green once there is a question.
                'max-h-36 min-h-9 w-full resize-none rounded-md border bg-card px-3 py-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-60',
                draft.trim() ? 'border-success/60' : 'border-warning/60',
              )}
            />
            {near && (
              <span
                className={cn(
                  'pointer-events-none absolute bottom-1.5 right-2 text-[0.65rem] tabular-nums',
                  draft.length >= MAX_Q ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {draft.length}/{MAX_Q}
              </span>
            )}
          </div>

          {pending ? (
            <Button type="button" variant="outline" size="icon" onClick={stopAsking} aria-label="Stop">
              <Square />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!canSend || spent} aria-label="Send">
              <Send />
            </Button>
          )}
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {spent ? (
            'The assistant opens again tomorrow.'
          ) : (
            <>
              <CornerDownLeft className="size-3" aria-hidden /> Enter to send
              <span className="text-border">·</span>
              <span className={left <= 5 ? 'text-warning' : undefined}>{left} left today</span>
            </>
          )}
        </p>
      </form>

      <TutorialPlayer tutorial={playing} onClose={() => setPlaying(null)} />
    </div>
  )
}

/** Nothing asked yet. */
function Opening({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-lg border border-tone-violet/30 bg-tone-violet/5 p-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-tone-violet" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Ask how to do something in the app and I will tell you where it is.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {OPENERS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="group flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-tone-violet/40 hover:bg-accent hover:text-accent-foreground"
          >
            {q}
            <ArrowUpRight
              className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-tone-violet"
              aria-hidden
            />
          </button>
        ))}
      </div>
    </div>
  )
}

/** Three dots: a spinner says "loading", this says "thinking". */
function Thinking() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-pulse rounded-full bg-tone-violet"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      Looking it up…
    </div>
  )
}

function Bubble({
  said,
  at,
  tutorials,
  onWatch,
}: {
  said: Said
  at: number
  tutorials: readonly Tutorial[]
  onWatch: (t: Tutorial) => void
}) {
  if (said.role === 'user') {
    return (
      <div className="max-w-[85%] self-end rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
        {said.text}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'max-w-[92%] overflow-x-auto rounded-md border px-3 py-2 text-sm leading-relaxed',
          // Red only for a real problem; an answer we could not give is one.
          said.broke ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/40',
        )}
      >
        <RichText text={said.text} />
      </div>

      {said.sources && said.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {said.sources.map((s) => {
            const video = s.video ? tutorials.find((t) => t.key === s.video) : undefined
            return (
              <span key={s.title} className="flex flex-wrap gap-1.5">
                {s.to ? (
                  <Link
                    to={s.to}
                    className="flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {s.title} <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                ) : (
                  <span className="rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground">
                    {s.title}
                  </span>
                )}
                {/* Every answer has always carried a tutorial key; nothing drew it. */}
                {video && (
                  <button
                    type="button"
                    onClick={() => onWatch(video)}
                    className="flex items-center gap-1 rounded-sm border border-primary/40 bg-card px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
                  >
                    <Play className="size-3" aria-hidden /> Watch · {lengthLabel(video.seconds)}
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {said.callUrl && (
        <Button variant="outline" size="sm" className="self-start" asChild>
          {/* Opens away from the app, so the conversation is still here afterwards. */}
          <a href={said.callUrl} target="_blank" rel="noreferrer noopener">
            <CalendarClock /> Book a call
          </a>
        </Button>
      )}

      {/* Nothing to copy or rate on a failure: that answer was ours, not the
          knowledge base's. */}
      {!said.broke && <Actions at={at} said={said} />}
    </div>
  )
}

/** Copy, and did this help. */
function Actions({ at, said }: { at: number; said: Said }) {
  const send = useAssistantFeedback()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(said.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy — select the answer and copy it by hand')
    }
  }

  const say = (helpful: boolean) => {
    markHelpful(at, helpful)
    if (said.logId) send.mutate({ log_id: said.logId, helpful })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy this answer"
        className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </button>

      {/* Only where there is a row to mark: without a log id the thumb has
          nowhere to go, and a button that does nothing is worse than none. */}
      {said.logId && said.helpful == null && (
        <>
          <span className="text-border">·</span>
          <span className="text-xs text-muted-foreground">Did this help?</span>
          <button
            type="button"
            onClick={() => say(true)}
            aria-label="Yes, that helped"
            className="rounded-sm px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-success"
          >
            <ThumbsUp className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => say(false)}
            aria-label="No, that did not help"
            className="rounded-sm px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-warning"
          >
            <ThumbsDown className="size-3.5" aria-hidden />
          </button>
        </>
      )}
      {said.helpful === true && <span className="text-xs text-success">· Glad that helped</span>}
      {said.helpful === false && (
        <span className="text-xs text-muted-foreground">
          · Thanks for saying. Press Help at the foot of the menu and we will answer.
        </span>
      )}
    </div>
  )
}
