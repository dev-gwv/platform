import { useMemo, useState } from 'react'
import { MessageCircle, NotebookPen, Phone, Pin } from 'lucide-react'
import type { CrmActivity } from '@ipc/contracts'
import { CALL_OUTCOMES } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useActivities, useLogActivity } from '../api'

type Channel = 'note' | 'call' | 'whatsapp'

const CHANNELS: ReadonlyArray<{ key: Channel; label: string; icon: typeof Phone }> = [
  { key: 'note', label: 'Note', icon: NotebookPen },
  { key: 'call', label: 'Call', icon: Phone },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
]

const THREAD_TYPES = new Set(['note', 'call', 'whatsapp', 'sms', 'email', 'meeting'])
const stamp = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** Answered in green, missed in amber, a wrong number in rose. */
function outcomeTone(outcome: string | null): string {
  if (!outcome) return 'text-muted-foreground'
  if (outcome === 'wrong_number') return 'text-tone-rose'
  if (CALL_OUTCOMES.find((o) => o.key === outcome)?.missed) return 'text-tone-amber'
  return 'text-tone-green'
}

/**
 * "What did you talk about?" -- the conversation with this family, newest
 * first, with the box to add to it on top.
 *
 * One notes box per lead was overwritten each time, so the history of what
 * was promised lived in someone's head. Every note is its own line now,
 * stamped with who and when; the old box is the first, pinned one (0209).
 */
export function NoteComposer({ leadId, onSaved, autoFocus }: { leadId: string; onSaved?: () => void; autoFocus?: boolean }) {
  const log = useLogActivity()
  const [channel, setChannel] = useState<Channel>('note')
  const [outcome, setOutcome] = useState<string | null>(null)
  const [text, setText] = useState('')
  const needsOutcome = channel === 'call' && !outcome
  const empty = channel !== 'call' && !text.trim()

  function save() {
    if (needsOutcome || empty || log.isPending) return
    log.mutate(
      {
        lead_id: leadId,
        type: channel,
        direction: channel === 'note' ? 'none' : 'out',
        ...(text.trim() ? { body: text.trim() } : {}),
        ...(channel === 'call' && outcome ? { outcome, started_at: new Date().toISOString() } : {}),
      },
      {
        onSuccess: () => {
          setText('')
          setOutcome(null)
          onSaved?.()
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What kind of note">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={channel === c.key}
            onClick={() => {
              setChannel(c.key)
              if (c.key !== 'call') setOutcome(null)
            }}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
              channel === c.key
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            <c.icon className="size-3.5" /> {c.label}
          </button>
        ))}
      </div>
      {channel === 'call' && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How did the call go">
          {CALL_OUTCOMES.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={outcome === o.key}
              onClick={() => setOutcome(o.key)}
              className={cn(
                'h-7 rounded-full border px-2.5 text-xs transition-colors',
                outcome === o.key
                  ? o.missed
                    ? 'border-tone-amber bg-tone-amber text-card'
                    : o.key === 'wrong_number'
                      ? 'border-tone-rose bg-tone-rose text-card'
                      : 'border-tone-green bg-tone-green text-card'
                  : 'border-dashed border-tone-amber/60 bg-tone-amber-soft/40 text-foreground hover:border-tone-amber',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
        }}
        rows={2}
        placeholder="What happened? What they asked for, what you promised…"
        className={cn(
          'min-h-14 w-full rounded-md border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          text.trim() ? 'border-tone-green/50' : 'border-input',
        )}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.7rem] text-muted-foreground">
          {needsOutcome ? 'Pick how the call went first.' : '⌘/Ctrl + Enter to save'}
        </span>
        <Button size="sm" onClick={save} disabled={needsOutcome || empty || log.isPending}>
          {channel === 'call' ? 'Log call' : 'Add note'}
        </Button>
      </div>
    </div>
  )
}

function ThreadItem({ a, n }: { a: CrmActivity; n: number }) {
  const outcomeLabel = a.outcome ? (CALL_OUTCOMES.find((o) => o.key === a.outcome)?.label ?? a.outcome) : null
  const kind = a.type === 'note' ? 'Note' : a.type === 'whatsapp' ? 'WhatsApp' : a.type.charAt(0).toUpperCase() + a.type.slice(1)
  const pinned = a.meta['pinned'] === true
  return (
    <li className={cn('rounded-md px-3 py-2', pinned ? 'bg-tone-amber-soft/50' : 'bg-muted/40')}>
      <p className="flex flex-wrap items-center gap-x-1.5 text-[0.7rem] text-muted-foreground">
        {pinned && <Pin className="size-3 text-tone-amber" aria-label="Pinned" />}
        <span>#{n}</span>
        <span>·</span>
        <span>{stamp.format(new Date(a.started_at ?? a.created_at))}</span>
        {a.actor_name && (
          <>
            <span>·</span>
            <span>{a.actor_name}</span>
          </>
        )}
        <span>·</span>
        <span className={cn('font-medium', a.type === 'call' ? outcomeTone(a.outcome) : 'text-foreground/70')}>
          {kind}
          {outcomeLabel ? ` — ${outcomeLabel}` : ''}
        </span>
      </p>
      {(a.body || a.subject) && <p className="mt-0.5 whitespace-pre-wrap text-sm">{a.body ?? a.subject}</p>}
    </li>
  )
}

export function NotesThread({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const acts = useActivities({ leadId })
  const [all, setAll] = useState(false)
  const items = useMemo(() => {
    const rows = (acts.data ?? []).filter((a) => THREAD_TYPES.has(a.type))
    // Numbered oldest-first so #1 is the start of the conversation.
    const numbered = [...rows]
      .sort((x, y) => new Date(x.started_at ?? x.created_at).getTime() - new Date(y.started_at ?? y.created_at).getTime())
      .map((a, i) => ({ a, n: i + 1 }))
      .reverse()
    const pinned = numbered.filter((r) => r.a.meta['pinned'] === true)
    return [...pinned, ...numbered.filter((r) => r.a.meta['pinned'] !== true)]
  }, [acts.data])
  const shown = all ? items : items.slice(0, 3)

  return (
    <section className="rounded-xl border border-border border-l-4 border-l-tone-green bg-card p-3" aria-label="Notes">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tone-green">
        Notes — what did you talk about?
        {items.length > 0 && <span className="rounded-full bg-tone-green-soft px-1.5 text-[0.65rem]">{items.length}</span>}
      </h3>
      {canEdit && <NoteComposer leadId={leadId} />}
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No notes yet. The first one starts the thread.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {shown.map(({ a, n }) => (
            <ThreadItem key={a.id} a={a} n={n} />
          ))}
        </ul>
      )}
      {items.length > 3 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-medium text-primary hover:underline">
          {all ? 'Show less' : `View all ${items.length} notes`}
        </button>
      )}
    </section>
  )
}
