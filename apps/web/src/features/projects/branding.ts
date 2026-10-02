/**
 * What a quotation is missing that the client would need: how to reach the
 * studio. A logo or a GST number is nice to have, not a blocker -- a banner
 * asking for them on every visit is one that never goes away.
 */
export interface BrandingFields {
  invoice_address?: string | null | undefined
  invoice_phone?: string | null | undefined
  invoice_email?: string | null | undefined
}

export function brandingGaps(c: BrandingFields | null | undefined): string[] {
  if (!c) return []
  return (
    [
      [!c.invoice_address?.trim(), 'address'],
      [!c.invoice_phone?.trim(), 'phone'],
      [!c.invoice_email?.trim(), 'email'],
    ] as const
  )
    .filter(([missing]) => missing)
    .map(([, label]) => label)
}
