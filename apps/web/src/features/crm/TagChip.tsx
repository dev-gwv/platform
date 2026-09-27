import type { LeadTag, TagColor } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'

/**
 * A tag, in one of the six theme hues.
 *
 * StatusBadge is the locked primitive for *status* — a stage, an outcome, a
 * warning. A tag is not a status: it is a label the studio invented, and two of
 * them on a row must be distinguishable at a glance. So it borrows the same
 * shape and the same token pairs (`tone-*` and `tone-*-soft`, both redefined
 * for dark mode) rather than inventing a colour or reaching for a hex code.
 */
const HUES: Record<TagColor, string> = {
  blue: 'bg-tone-blue-soft text-tone-blue',
  green: 'bg-tone-green-soft text-tone-green',
  violet: 'bg-tone-violet-soft text-tone-violet',
  amber: 'bg-tone-amber-soft text-tone-amber',
  rose: 'bg-tone-rose-soft text-tone-rose',
  teal: 'bg-tone-teal-soft text-tone-teal',
}

export function TagChip({
  tag,
  className,
  onRemove,
}: {
  tag: LeadTag
  className?: string
  /**
   * When given, the chip carries a × — used in the picker, not on a row.
   *
   * Spelled `| undefined` because exactOptionalPropertyTypes is on: a caller
   * that decides at render time whether the chip is removable passes undefined
   * explicitly, and `?:` alone would reject it.
   */
  onRemove?: (() => void) | undefined
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium',
        HUES[tag.color],
        className,
      )}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-0.5 shrink-0 rounded-full px-0.5 leading-none opacity-70 hover:opacity-100"
        >
          ×<span className="sr-only">Remove tag {tag.name}</span>
        </button>
      )}
    </span>
  )
}

/**
 * Tags on a table row.
 *
 * Capped, because a lead with nine tags would push the columns that decide who
 * to ring off the screen. The rest are counted, and the drawer has them all.
 */
export function TagChips({ tags, max = 3 }: { tags: readonly LeadTag[]; max?: number }) {
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground">+{rest}</span>}
    </span>
  )
}
