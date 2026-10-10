import { useEffect, useRef, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CalendarClock, Loader2, Send, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { AskReply, AssistantTurn } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { RichText } from './rich-text'
import { useAsk, useAssistantFeedback } from './api'
import { addSaid, markHelpful, setDraft, snapshot, subscribe, type Said } from './thread'

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
 * answer arrives whole in a second or two, which is the better trade.
 */

/** Sent back with each question. Enough for a follow-up, not enough to crowd the prompt. */
const CARRY = 6

const OPENERS = [
  'How do I add my team?',
  'How do I send a quotation?',
  'How do I book crew for a shoot day?',
]

export function AssistantPanel({ callUrl, left }: { callUrl: string | null; left: number }) {
  const { said, draft } = useSyncExternalStore(subscribe, snapshot, snapshot)
  const ask = useAsk()
  const thread = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Keep the newest exchange in view as it arrives.
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' })
  }, [said, ask.isPending])

  const spent = left <= 0

  function send(question: string) {
    const q = question.trim()
    if (!q || ask.isPending || spent) return

    // The history is what was on screen BEFORE this question, which is why it
    // is taken here rather than from `said` inside the callback.
    const history: AssistantTurn[] = said.slice(-CARRY).map((t) => ({ role: t.role, content: t.text }))
    addSaid({ role: 'user', text: q })
    setDraft('')

    ask.mutate(
      { question: q, history },
      {
        onSuccess: (r: AskReply) =>
          addSaid({
            role: 'assistant',
            text: r.answer,
            sources: r.sources,
            callUrl: r.call_url,
            broke: r.status === 'failed',
            logId: r.log_id,
            helpful: null,
          }),
        onError: (e: Error) => addSaid({ role: 'assistant', text: e.message, callUrl, broke: true }),
      },
    )
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={thread} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {said.length === 0 ? (
          <Opening onPick={send} />
        ) : (
          <div className="flex flex-col gap-3">
            {said.map((s, i) => (
              <Bubble key={i} said={s} at={i} />
            ))}
            {ask.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Looking it up…
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={box}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={500}
            disabled={spent}
            aria-label="Your question"
            placeholder={spent ? 'You have used today’s questions.' : 'Ask about anything in the app…'}
            className={cn(
              // Every control looks like a control: a real border, and amber
              // while it is empty and waiting for something.
              'max-h-28 min-h-9 flex-1 resize-none rounded-md border bg-card px-3 py-2 text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-60',
              draft.trim() ? 'border-success/60' : 'border-warning/60',
            )}
          />
          <Button type="submit" size="icon" disabled={!draft.trim() || ask.isPending || spent} aria-label="Send">
            {ask.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {spent
            ? 'The assistant opens again tomorrow.'
            : `Answers come from the app’s own help. ${left} question${left === 1 ? '' : 's'} left today.`}
        </p>
      </form>
    </div>
  )
}

/** Nothing asked yet: three real questions, because a blank box asks nothing. */
function Opening({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
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
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {q}
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  )
}

function Bubble({ said, at }: { said: Said; at: number }) {
  if (said.role === 'user') {
    return (
      <div className="self-end rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground max-w-[85%]">
        {said.text}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'max-w-[92%] rounded-md border px-3 py-2 text-sm leading-relaxed',
          // Red only for a real problem; an answer we could not give is one.
          said.broke ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/40',
        )}
      >
        <RichText text={said.text} />
      </div>

      {said.sources && said.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {said.sources.map((s) =>
            s.to ? (
              <Link
                key={s.title}
                to={s.to}
                className="rounded-sm border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Open {s.title}
              </Link>
            ) : (
              <span key={s.title} className="rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground">
                {s.title}
              </span>
            ),
          )}
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

      {/* Nothing to say about a failure, and nothing to learn from a thumb on
          one: the answer was ours, not the knowledge base's. */}
      {!said.broke && said.logId && <Helpful at={at} said={said} />}
    </div>
  )
}

/**
 * Did this help?
 *
 * The status of an answer is not its quality -- one can be fluent, well
 * sourced, logged as 'answered' and still wrong, and the only person who knows
 * is the studio owner reading it. This is the whole feedback loop on whether
 * the knowledge base is any good, so it stays to two taps and never nags: once
 * they have said, it says thank you and stops asking.
 */
function Helpful({ at, said }: { at: number; said: Said }) {
  const send = useAssistantFeedback()

  if (said.helpful === true) return <p className="text-xs text-success">Thanks — glad that helped.</p>
  if (said.helpful === false) {
    return (
      <p className="text-xs text-muted-foreground">
        Thanks for saying. If you need this now, press Help at the foot of the menu and we will answer.
      </p>
    )
  }

  const say = (helpful: boolean) => {
    markHelpful(at, helpful)
    if (said.logId) send.mutate({ log_id: said.logId, helpful })
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Did this help?</span>
      <button
        type="button"
        onClick={() => say(true)}
        aria-label="Yes, that helped"
        className="rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <ThumbsUp className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => say(false)}
        aria-label="No, that did not help"
        className="rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <ThumbsDown className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
