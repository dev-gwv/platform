import type { z } from '@ipc/contracts'

/**
 * Per-field validation messages, derived from the SAME zod contract the server
 * validates with. The rule lives in the contract; this only turns a rule that
 * failed into a sentence a person can act on. Nothing here re-states a limit,
 * so tightening `password: z.string().min(8)` to `.min(12)` changes the copy
 * automatically instead of leaving the form telling a comfortable lie.
 */
export type FieldErrors<K extends string> = Partial<Record<K, string | undefined>>

/** Blank means "you haven't filled this in", whatever rule technically failed. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/**
 * One zod issue → one sentence. `label` is the field's on-screen name, so the
 * message reads the way the form does ("Password must be at least 8 characters."
 * rather than "String must contain at least 8 character(s)").
 */
function messageForIssue(issue: z.ZodIssue, label: string): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' ? `${label} is required.` : `${label} is not valid.`

    case 'too_small': {
      const min = Number(issue.minimum)
      if (issue.type === 'string') {
        return min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`
      }
      return `${label} must be at least ${min}.`
    }

    case 'too_big': {
      const max = Number(issue.maximum)
      if (issue.type === 'string') return `${label} must be ${max} characters or fewer.`
      return `${label} must be at most ${max}.`
    }

    case 'invalid_string':
      if (issue.validation === 'email') return 'Enter a valid email address, like you@studio.in.'
      return `${label} is not in the right format.`

    default:
      // Includes the contracts' custom issues (e.g. phone normalisation), whose
      // own message is written for logs, not for a form — callers override those.
      return `${label} is not valid.`
  }
}

interface Options<K extends string> {
  /** On-screen name per field, used to build the message. */
  labels: Record<K, string>
  /**
   * Replaces every message for that field. Only for fields whose failure modes
   * all collapse to one sentence (a phone number is either parseable or not);
   * a field with several distinct limits should keep the derived messages.
   */
  overrides?: Partial<Record<K, string | undefined>>
}

/**
 * Validate `value` against `schema` and return one message per failing field.
 * Only the FIRST issue per field is kept — a stack of messages under one input
 * is noise, and fixing the first usually clears the rest.
 */
export function fieldErrors<K extends string>(
  schema: z.ZodType,
  value: Record<string, unknown>,
  { labels, overrides = {} }: Options<K>,
): FieldErrors<K> {
  const parsed = schema.safeParse(value)
  if (parsed.success) return {}

  const errors: FieldErrors<K> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as K | undefined
    // A whole-object issue (e.g. a cross-field refine) has no field to sit under.
    if (field === undefined || field in errors) continue
    const label = labels[field] ?? 'This field'
    errors[field] = isBlank(value[field])
      ? `${label} is required.`
      : (overrides[field] ?? messageForIssue(issue, label))
  }
  return errors
}
