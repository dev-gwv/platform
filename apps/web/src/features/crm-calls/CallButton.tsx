import { useState, type ReactNode } from 'react'
import { Phone } from 'lucide-react'
import { CALL_OUTCOMES } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/shared/ui/popover'
import { cn } from '@/shared/ui/cn'
import { useLogCall } from './api'
import { NEXT_CALLS, nextCallAt, suggestedNext, type NextCall } from './next-call'

/**
 * Call, then say how it went. The dial happens on the first tap, always --
 * nothing stands between a person and the call. When they come back to the
 * screen the question is already waiting: pick the outcome (the next call is
 * suggested from it), Save. Two taps, and the lead, the queue and the
 * "unreachable" count are all up to date.
 */
export function CallButton({
  lead,
  size = 'sm',
  variant = 'outline',
  className,
  children,
}: {
  lead: { id: string; phone: string | null; name?: string | null }
  size?: 'sm' | 'default' | 'icon'
  variant?: 'outline' | 'default' | 'ghost'
  className?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [next, setNext] = useState<NextCall>('none')
  const [note, setNote] = useState('')
  const [more, setMore] = useState(false)
  const log = useLogCall()

  const reset = () => {
    setOutcome(null)
    setNext('none')
    setNote('')
    setMore(false)
  }

  if (!lead.phone) {
    return (
      <Button variant={variant} size={size} disabled className={className}>
        <Phone /> {children ?? 'Call'}
      </Button>
    )
  }

  const shown = more ? CALL_OUTCOMES : CALL_OUTCOMES.slice(0, 4)
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <PopoverAnchor asChild>
        <Button variant={variant} size={size} asChild className={className}>
          <a href={`tel:${lead.phone}`} onClick={() => setOpen(true)} aria-label={`Call ${lead.name ?? ''}`.trim()}>
            <Phone /> {children ?? 'Call'}
          </a>
        </Button>
      </PopoverAnchor>
      <PopoverContent className="w-72 p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <p className="text-sm font-semibold">How did the call go?</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                setOutcome(o.key)
                setNext(suggestedNext(o.key))
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium',
                outcome === o.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
              )}
            >
              {o.label}
            </button>
          ))}
          {!more && (
            <button type="button" onClick={() => setMore(true)} className="px-1 text-xs text-muted-foreground hover:text-foreground">
              More…
            </button>
          )}
        </div>
        {outcome && (
          <>
            <p className="mt-3 text-xs font-medium text-muted-foreground">Next call</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {NEXT_CALLS.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => setNext(n.key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs',
                    next === n.key ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted',
                  )}
                >
                  {n.label}
                </button>
              ))}
            </div>
            <Input
              className="mt-3 h-8 text-sm"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Call note"
            />
          </>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Not now
          </Button>
          <Button
            size="sm"
            disabled={!outcome || log.isPending}
            onClick={() =>
              outcome &&
              log.mutate(
                { leadId: lead.id, outcome, note, nextAt: nextCallAt(next) },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            {log.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
