/**
 * The events a wedding studio is asked about most, offered until the studio
 * adds its own (Settings → Lookups, "project_type") -- which it can do from
 * the lead form itself.
 */
export const EVENT_TYPE_DEFAULTS = [
  'Wedding',
  'Pre-wedding',
  'Engagement',
  'Reception',
  'Haldi / Mehendi',
  'Birthday',
  'Maternity',
  'Corporate',
].map((v) => ({ value: v, label: v }))
