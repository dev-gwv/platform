import type { ReactNode } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import { cn } from './cn'

/**
 * The hues a chip can wear. Named by colour, not meaning, like the header
 * quick links: a caller decides what a colour stands for (a production stage,
 * a kind of shoot) and keeps using the same one for it.
 */
export type Tone = 'blue' | 'green' | 'violet' | 'amber' | 'rose' | 'teal'

const IDLE: Record<Tone, string> = {
  blue: 'border-tone-blue/30 bg-tone-blue-soft text-tone-blue hover:border-tone-blue',
  green: 'border-tone-green/30 bg-tone-green-soft text-tone-green hover:border-tone-green',
  violet: 'border-tone-violet/30 bg-tone-violet-soft text-tone-violet hover:border-tone-violet',
  amber: 'border-tone-amber/30 bg-tone-amber-soft text-tone-amber hover:border-tone-amber',
  rose: 'border-tone-rose/30 bg-tone-rose-soft text-tone-rose hover:border-tone-rose',
  teal: 'border-tone-teal/30 bg-tone-teal-soft text-tone-teal hover:border-tone-teal',
}

const ON: Record<Tone, string> = {
  blue: 'border-tone-blue bg-tone-blue text-card',
  green: 'border-tone-green bg-tone-green text-card',
  violet: 'border-tone-violet bg-tone-violet text-card',
  amber: 'border-tone-amber bg-tone-amber text-card',
  rose: 'border-tone-rose bg-tone-rose text-card',
  teal: 'border-tone-teal bg-tone-teal text-card',
}

/** The tinted look without the hover, for a label that is not a button. */
export const TONE_CHIP_STATIC: Record<Tone, string> = {
  blue: 'border-tone-blue/30 bg-tone-blue-soft text-tone-blue',
  green: 'border-tone-green/30 bg-tone-green-soft text-tone-green',
  violet: 'border-tone-violet/30 bg-tone-violet-soft text-tone-violet',
  amber: 'border-tone-amber/30 bg-tone-amber-soft text-tone-amber',
  rose: 'border-tone-rose/30 bg-tone-rose-soft text-tone-rose',
  teal: 'border-tone-teal/30 bg-tone-teal-soft text-tone-teal',
}

/** Text + dot colour for a heading that introduces a group of chips of one tone. */
export const TONE_TEXT: Record<Tone, string> = {
  blue: 'text-tone-blue',
  green: 'text-tone-green',
  violet: 'text-tone-violet',
  amber: 'text-tone-amber',
  rose: 'text-tone-rose',
  teal: 'text-tone-teal',
}
export const TONE_DOT: Record<Tone, string> = {
  blue: 'bg-tone-blue',
  green: 'bg-tone-green',
  violet: 'bg-tone-violet',
  amber: 'bg-tone-amber',
  rose: 'bg-tone-rose',
  teal: 'bg-tone-teal',
}

/** A fixed rotation, so the nth chip in a list is always the same colour. */
export const TONE_CYCLE: readonly Tone[] = ['violet', 'blue', 'teal', 'green', 'amber', 'rose']
export const toneAt = (i: number): Tone => TONE_CYCLE[i % TONE_CYCLE.length]!

/**
 * A tappable suggestion: "+ Candid Photographer".
 *
 * Suggestions used to be grey outlines on white, indistinguishable from the
 * text around them until hovered — easy to read past as decoration rather
 * than as things you can press. A tinted fill says "this is a button" at a
 * glance, and a colour per group lets the eye find the group before the word.
 *
 * `selected` fills it solid with a tick; `count` shows how many are already
 * picked, so a chip that has been tapped twice says ×2 on itself rather than
 * making anyone scroll to a list to find out.
 */
export function ToneChip({
  tone,
  label,
  onClick,
  selected = false,
  count,
  disabled,
  title,
  icon,
}: {
  tone: Tone
  label: ReactNode
  onClick: () => void
  selected?: boolean
  count?: number | undefined
  disabled?: boolean | undefined
  title?: string | undefined
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={selected || undefined}
      className={cn(
        'press inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected ? ON[tone] : IDLE[tone],
      )}
    >
      {icon ?? (selected ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />)}
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-0.5 rounded-full bg-card/25 px-1.5 text-xs font-semibold tabular-nums">×{count}</span>
      )}
    </button>
  )
}

/**
 * A number you change with buttons you can see.
 *
 * The browser's own number spinner only appears on hover, and on a phone not
 * at all, so "how many" read as a fixed 1 that nobody thought to change.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  /** What is being counted, for screen readers: "Candid Photographer". */
  label: string
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const btn =
    'flex size-7 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none'
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={`How many ${label}`}>
      <button type="button" className={btn} onClick={() => onChange(clamp(value - 1))} disabled={value <= min}>
        <Minus className="size-3.5" aria-hidden />
        <span className="sr-only">One fewer {label}</span>
      </button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ''))
          if (Number.isFinite(n) && n > 0) onChange(clamp(n))
        }}
        aria-label={`Number of ${label}`}
        className="h-7 w-10 rounded-md border border-input bg-card text-center text-sm font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button type="button" className={btn} onClick={() => onChange(clamp(value + 1))} disabled={value >= max}>
        <Plus className="size-3.5" aria-hidden />
        <span className="sr-only">One more {label}</span>
      </button>
    </div>
  )
}
