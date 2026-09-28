/**
 * The seven colours a studio can give a stage, a quality, a source or a
 * follow-up priority (0209): the six theme hues and a quiet slate. Stored as
 * the name, drawn through the theme's tokens, so dark mode and a studio's
 * own theme still hold.
 */
export const TONES = ['blue', 'green', 'violet', 'amber', 'rose', 'teal', 'slate'] as const
export type ToneName = (typeof TONES)[number]

export const isTone = (v: unknown): v is ToneName => typeof v === 'string' && (TONES as readonly string[]).includes(v)

/** A chip in that colour: tinted fill, coloured text, a border you can see. */
export const TONE_CHIP: Record<ToneName, string> = {
  blue: 'border-tone-blue/35 bg-tone-blue-soft text-tone-blue',
  green: 'border-tone-green/35 bg-tone-green-soft text-tone-green',
  violet: 'border-tone-violet/35 bg-tone-violet-soft text-tone-violet',
  amber: 'border-tone-amber/35 bg-tone-amber-soft text-tone-amber',
  rose: 'border-tone-rose/35 bg-tone-rose-soft text-tone-rose',
  teal: 'border-tone-teal/35 bg-tone-teal-soft text-tone-teal',
  slate: 'border-border bg-muted text-muted-foreground',
}

export const TONE_BG: Record<ToneName, string> = {
  blue: 'bg-tone-blue',
  green: 'bg-tone-green',
  violet: 'bg-tone-violet',
  amber: 'bg-tone-amber',
  rose: 'bg-tone-rose',
  teal: 'bg-tone-teal',
  slate: 'bg-muted-foreground/50',
}

/** The raw CSS colour, for a border or a rule drawn with style={}. */
export const toneVar = (t: ToneName | null | undefined): string =>
  !t || t === 'slate' ? 'var(--muted-foreground)' : `var(--tone-${t})`

/** Read a stored colour defensively: anything unknown is slate. */
export const toneOf = (v: string | null | undefined): ToneName => (isTone(v) ? v : 'slate')
