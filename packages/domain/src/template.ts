/**
 * Template variable substitution for quotations / terms / emails.
 * Replaces {{key}} (whitespace-tolerant) with the provided value. Unknown
 * placeholders collapse to an empty string so half-filled docs never leak
 * "{{client_name}}" to a client.
 */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key]
    return v === null || v === undefined ? '' : String(v)
  })
}

/** List the {{placeholders}} referenced by a template. */
export function templateVariables(body: string): string[] {
  const set = new Set<string>()
  for (const m of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) set.add(m[1] as string)
  return [...set]
}

export function crmTemplateVars(lead: {
  name?: string | null
  phone?: string | null
  email?: string | null
  follow_up_at?: string | null
  city?: string | null
  group_name?: string | null
  event_type?: string | null
  event_date?: string | null
  deal_value?: number | string | null
}, studio: string): Record<string, string> {
  const followUp = lead.follow_up_at ? new Date(lead.follow_up_at) : null
  return {
    name: lead.name ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    studio,
    follow_up_date:
      followUp && !Number.isNaN(followUp.getTime())
        ? followUp.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        : '',
    city: lead.city ?? '',
    group: lead.group_name ?? '',
    event_type: lead.event_type ?? '',
    event_date: lead.event_date ?? '',
    deal_value: lead.deal_value === null || lead.deal_value === undefined ? '' : String(lead.deal_value),
  }
}
