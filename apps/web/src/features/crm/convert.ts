/**
 * What the Book it form starts with: the project named after the lead, and
 * the price the client talked about (the lead's Budget) -- the booked price,
 * which the studio confirms.
 */
export function convertDefaults(lead: { name: string | null; deal_value: number | null }): { name: string; cost: string } {
  const who = (lead.name ?? '').trim()
  return {
    name: who ? `${who} project` : 'New project',
    cost: lead.deal_value != null && lead.deal_value > 0 ? String(lead.deal_value) : '',
  }
}
