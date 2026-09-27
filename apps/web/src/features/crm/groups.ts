import type { CrmLead } from '@ipc/contracts'

/**
 * Lead groups -- the word a studio types on a lead ("Dec 2027", "Corporate",
 * "Referral") to mean a batch it thinks about together.
 *
 * These were written for a two-bar filter strip that sat above every list.
 * The strip is gone; the rules are not, because they are how the Group filter
 * inside Filter still narrows the list, and they are covered by tests.
 */

export const ALL_GROUPS = '__all__'
export const NO_GROUP = '__none__'

/** Every group a studio has actually typed on a lead, in the order it reads. */
export function groupsOf(leads: readonly CrmLead[]): string[] {
  const seen = new Set<string>()
  for (const l of leads) {
    const g = l.group_name?.trim()
    if (g) seen.add(g)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/** Narrow a list to one group. `group_name` was writable in two places and read by nothing. */
export function inGroup(leads: readonly CrmLead[], group: string): CrmLead[] {
  if (group === ALL_GROUPS) return [...leads]
  if (group === NO_GROUP) return leads.filter((l) => !l.group_name?.trim())
  return leads.filter((l) => l.group_name?.trim() === group)
}
