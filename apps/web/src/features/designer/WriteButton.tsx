import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { DESIGN_TONES, type DesignWriteReply, type DesignWriteRequest } from '@ipc/contracts'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/ui/cn'

export type WriteAsk = Pick<DesignWriteRequest, 'kind' | 'current' | 'lines'>
/** Supplied by the editor: the design's studio, project and client are added there. */
export type Writer = (
  ask: WriteAsk & { tone: DesignWriteRequest['tone']; hint: string },
) => Promise<DesignWriteReply>

const TONE_NAMES: Record<(typeof DESIGN_TONES)[number], string> = {
  warm: 'Warm',
  premium: 'Premium',
  fun: 'Fun',
  hinglish: 'Hinglish',
}

/**
 * "Write it for me" beside a part of the page (Quotation Designer, 0296): a
 * tone, an optional line from the studio, then the AI's words go straight
 * onto the page, where they can be typed over like anything else.
 */
export function WriteButton({
  ask,
  writer,
  onWritten,
  className,
}: {
  ask: WriteAsk
  writer: Writer
  onWritten: (r: DesignWriteReply) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [tone, setTone] = useState<(typeof DESIGN_TONES)[number]>(() => {
    try {
      return (localStorage.getItem('designer-tone') as (typeof DESIGN_TONES)[number]) || 'warm'
    } catch {
      return 'warm'
    }
  })
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)

  async function write() {
    setBusy(true)
    try {
      try {
        localStorage.setItem('designer-tone', tone)
      } catch {
        // A remembered tone is a convenience only.
      }
      onWritten(await writer({ ...ask, tone, hint }))
      setOpen(false)
    } catch {
      // The editor's writer shows the reason in a toast.
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'designer-chrome inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-violet-800 shadow-sm hover:bg-violet-100',
            className,
          )}
          style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14, fontWeight: 600 }}
        >
          <Sparkles className="size-4" aria-hidden /> Write it for me
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {DESIGN_TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                aria-pressed={tone === t}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium',
                  tone === t
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card hover:bg-muted',
                )}
              >
                {TONE_NAMES[t]}
              </button>
            ))}
          </div>
          <input
            value={hint}
            maxLength={300}
            onChange={(e) => setHint(e.target.value)}
            placeholder="Anything to mention? (optional)"
            className="h-9 rounded-md border border-border bg-card px-3 text-sm"
          />
          <button
            type="button"
            onClick={() => void write()}
            disabled={busy}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{' '}
            {busy ? 'Writing…' : 'Write'}
          </button>
          <p className="text-xs text-muted-foreground">
            It replaces the words here. Prices and numbers are kept as they are.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
