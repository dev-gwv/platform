/**
 * The message Help opens WhatsApp or email with: who is asking, from where,
 * so support can answer without asking back. The person still presses Send.
 */
export interface SupportContext {
  studio: string
  name: string
  role: string
  plan: string | null
  page: string
  at: Date
}

export function supportMessage(c: SupportContext): string {
  const when = c.at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
  return [
    'Hi Studio AutoPilot team, I need help with:',
    '',
    '',
    '---',
    `Studio: ${c.studio}`,
    `Me: ${c.name} (${c.role})`,
    `Plan: ${c.plan ?? 'Trial'}`,
    `Page: ${c.page}`,
    `Time: ${when}`,
  ].join('\n')
}

/** wa.me wants digits only, country code first. */
export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`
}

export function mailLink(email: string, studio: string, text: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(`Help for ${studio}`)}&body=${encodeURIComponent(text)}`
}
