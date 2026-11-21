/**
 * The one way to build a WhatsApp link (wa.me). Every screen and the API go
 * through here; ESLint refuses a hand-built `wa.me/` anywhere else.
 *
 * Before this there were six rules in twenty files: some sent a ten-digit
 * number without India's code (a chat with nobody), none took a typed
 * leading 0 ("09876543210"), and a few kept a foreign number's digits only
 * by luck.
 */

/**
 * The number as wa.me wants it -- digits with the country code, no plus --
 * or null when what was typed cannot be a phone number.
 *
 * - "+44 7700 900123", "0044 7700 900123" → 447700900123 (a code as typed is kept)
 * - "98765 43210", "09876543210", "919876543210", "+91 098765 43210" → 919876543210
 * - "14155550101" (11–15 digits, no plus) → kept as it is: it already carries a code
 * - "123", "" → null
 */
export function waNumber(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim()
  if (!raw) return null
  let d = raw.replace(/\D/g, '')
  const international = raw.startsWith('+') || d.startsWith('00')
  if (international) {
    d = d.replace(/^00/, '')
    // "+91 098765 43210": India's code with the trunk 0 still typed.
    if (d.length === 13 && d.startsWith('910')) d = `91${d.slice(3)}`
    return /^[1-9]\d{7,14}$/.test(d) ? d : null
  }
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 10) return /^[1-9]/.test(d) ? `91${d}` : null
  return /^[1-9]\d{10,14}$/.test(d) ? d : null
}

/**
 * A chat with that number, the text typed in when given; null when the
 * number cannot be a phone. `waLink(phone, text) ?? waShare(text)` when a
 * missing number should still let the person pick a chat.
 */
export function waLink(phone: string | null | undefined, text?: string | null): string | null {
  const n = waNumber(phone)
  if (!n) return null
  return text ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : `https://wa.me/${n}`
}

/** WhatsApp opens with the text typed in and asks whom to send it to. */
export function waShare(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** A chat with the number when it is one, else the same text to a chat the person picks. */
export function waLinkOrShare(phone: string | null | undefined, text: string): string {
  return waLink(phone, text) ?? waShare(text)
}
