/**
 * The one line under a shoot card that says what to do next -- borrowed from
 * the reference app, where every card carried "Prepare → Attend → Submit".
 * Ours walks the planning: a date and a venue, then who the day needs, then
 * assigning them, then done. Pure, so the order is tested.
 */
export interface ShootNextStepInput {
  /** ISO date, or null. */
  shoot_date: string | null
  /** True when the quick chip set today's date and nobody has changed it. */
  dateIsPlaceholder?: boolean
  location: string | null
  roles: number
  assigned: number
  required: number
}

export interface ShootNextStep {
  key: 'date' | 'venue' | 'roles' | 'assign' | 'ready'
  label: string
  /** Where on the card the fix is. */
  hint: string
  tone: 'amber' | 'green'
}

export function shootNextStep(s: ShootNextStepInput): ShootNextStep {
  if (!s.shoot_date || s.dateIsPlaceholder) {
    return { key: 'date', label: 'Set the date', hint: 'Tap Edit and pick the real day.', tone: 'amber' }
  }
  if (!s.location) {
    return { key: 'venue', label: 'Add the venue', hint: 'Tap Edit and type where it is.', tone: 'amber' }
  }
  if (s.roles === 0) {
    return { key: 'roles', label: 'Add who this day needs', hint: 'Tap a role below, or "Add who this day needs".', tone: 'amber' }
  }
  if (s.assigned < s.required) {
    return {
      key: 'assign',
      label: `Assign your team · ${s.assigned} of ${s.required} done`,
      hint: 'Tap Assign team on each role.',
      tone: 'amber',
    }
  }
  return { key: 'ready', label: `Team ready · ${s.assigned} of ${s.required}`, hint: 'Nothing left to plan for this day.', tone: 'green' }
}
