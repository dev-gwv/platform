import { useTheme } from '../theme/ThemeProvider'
import { cn } from './cn'
import { avatarColors, initialsFor } from './identity'

const SIZES = {
  sm: 'size-6 text-[0.6rem]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const

/**
 * A person, at a glance.
 *
 * Initials in a colour derived from the name — the same person is the same
 * colour on every screen, which is what makes a list scannable without
 * reading. No storage and no upload: a studio has a dozen people, not a
 * social network.
 */
export function Avatar({
  name,
  size = 'md',
  className,
  src,
}: {
  name: string | null | undefined
  size?: keyof typeof SIZES
  className?: string
  /** Their photo, when they have added one; initials otherwise. */
  src?: string | null | undefined
}) {
  const { scheme } = useTheme()
  const colors = avatarColors(name, scheme === 'dark')
  if (src) {
    return <img src={src} alt="" title={name ?? undefined} className={cn('shrink-0 rounded-full object-cover', SIZES[size], className)} />
  }

  return (
    <span
      aria-hidden
      title={name ?? undefined}
      style={colors}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        SIZES[size],
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  )
}

/**
 * Several people in the space of one. Overlapping is the convention and it
 * reads instantly; past the limit it says how many more rather than growing.
 */
export function AvatarGroup({
  names,
  limit = 3,
  size = 'sm',
  className,
}: {
  names: readonly string[]
  limit?: number
  size?: keyof typeof SIZES
  className?: string
}) {
  if (names.length === 0) return null
  const shown = names.slice(0, limit)
  const extra = names.length - shown.length

  return (
    <span className={cn('inline-flex items-center', className)}>
      {shown.map((name, i) => (
        <Avatar
          key={`${name}-${i}`}
          name={name}
          size={size}
          className={cn('ring-2 ring-card', i > 0 && '-ml-2')}
        />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card',
            SIZES[size],
            '-ml-2',
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  )
}

/** Avatar plus name, the pairing most tables want. */
export function PersonCell({
  name,
  secondary,
  size = 'md',
  className,
}: {
  name: string | null | undefined
  secondary?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <Avatar name={name} size={size} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name ?? 'Unnamed'}</span>
        {secondary && (
          <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
        )}
      </span>
    </span>
  )
}
