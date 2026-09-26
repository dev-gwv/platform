/**
 * Task canonicalisation. Studios define their own status/priority labels, but
 * everything collapses to a fixed canonical enum for logic + reporting. Pure,
 * mirrored by the DB where needed.
 */
export type CanonicalStatus = 'to_do' | 'in_progress' | 'review' | 'blocked' | 'completed' | 'cancelled'
export type CanonicalPriority = 'low' | 'medium' | 'high' | 'urgent'

export const CANONICAL_STATUSES: readonly CanonicalStatus[] = [
  'to_do',
  'in_progress',
  'review',
  'blocked',
  'completed',
  'cancelled',
]
export const CANONICAL_PRIORITIES: readonly CanonicalPriority[] = [
  'low',
  'medium',
  'high',
  'urgent',
]

/** Built-in custom statuses that live only in code (no DB row). */
export const BUILTIN_STATUS_CANONICAL: Readonly<Record<string, CanonicalStatus>> = {
  pending_review: 'in_progress',
  revision_required: 'in_progress',
  sent_to_client: 'completed',
}

/**
 * Resolve a task's canonical status from its custom code + the code's declared
 * category. Built-ins win; then the provided category; else fall back to to_do.
 */
export function canonicalStatus(
  customCode: string | null | undefined,
  category?: CanonicalStatus | null,
): CanonicalStatus {
  if (customCode && customCode in BUILTIN_STATUS_CANONICAL) {
    return BUILTIN_STATUS_CANONICAL[customCode] as CanonicalStatus
  }
  if (category && CANONICAL_STATUSES.includes(category)) return category
  return 'to_do'
}

/**
 * Derive canonical priority from a custom priority's colour tone.
 *   red|rose → urgent, orange|amber → high, blue|purple → medium, else low.
 */
export function priorityFromTone(tone: string | null | undefined): CanonicalPriority {
  switch ((tone ?? '').toLowerCase()) {
    case 'red':
    case 'rose':
      return 'urgent'
    case 'orange':
    case 'amber':
      return 'high'
    case 'blue':
    case 'purple':
      return 'medium'
    default:
      return 'low'
  }
}
