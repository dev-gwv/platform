import { z } from '@ipc/contracts'
import { useQuery } from '@tanstack/react-query'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

/**
 * One terms document, as both the client and the studio see it.
 *
 * The schema lives here rather than beside either page because two things now
 * render it: the public acknowledge page the client opens from their link, and
 * the in-app viewer the studio reads it in. A copy of this shape in each would
 * be one more pair that drifts — the failure this codebase keeps producing —
 * so there is exactly one.
 */
const paymentTerm = z.object({
  id: z.string().nullish(),
  label: z.string(),
  mode: z.string().nullish(),
  value: z.number().nullish(),
  due_trigger: z.string().nullish(),
  due_date: z.string().nullable().nullish(),
  notes: z.string().nullable().nullish(),
})

export const termsPayload = z.object({
  title: z.string().nullable(),
  body: z.string(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  company_name: z.string().nullable(),
  logo_url: z.string().nullable(),
  company_phone: z.string().nullable(),
  company_email: z.string().nullable(),
  company_address: z.string().nullable(),
  payment_summary: z.string().nullable(),
  sections: z.array(z.record(z.string(), z.unknown())).default([]),
  expires_at: z.string().nullable(),
  revoked: z.boolean().default(false),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  access_count: z.number().default(0),
  // Letterhead + bill-to: this is a legal document, so it has to say who issued
  // it, to whom, and when.
  company_legal_name: z.string().nullable().nullish(),
  company_website: z.string().nullable().nullish(),
  client_email: z.string().nullable().nullish(),
  client_address: z.string().nullable().nullish(),
  gstin: z.string().nullable().nullish(),
  document_number: z.string().nullable().nullish(),
  issued_at: z.string().nullable().nullish(),
  // Lovable parity round 2: structured payment table + totals + legal/footer.
  payment_terms: z.array(paymentTerm).nullish(),
  total_cost: z.number().nullish(),
  legal_note: z.string().nullable().nullish(),
  document_footer_note: z.string().nullable().nullish(),
  already_acknowledged: z.boolean().nullish(),
  // The client's finger-drawn signature (0220), a PNG data URL.
  signature: z.string().nullish(),
})
export type TermsPayload = z.infer<typeof termsPayload>

/**
 * Read a document as the studio, by id.
 *
 * Not the client link: that route resolves an access token and increments the
 * view counters on both the token and the document, which the Documents page
 * reports as client engagement. Reading your own paperwork should not look
 * like the client opening it, so this endpoint counts nothing.
 *
 * `enabled` on the id means the dialog can mount closed without fetching.
 */
export function useTermsDocumentPayload(documentId: string | null) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['terms', 'document', documentId],
    queryFn: () =>
      callApi(`/terms/documents/${documentId}/payload`, { responseSchema: termsPayload }),
    enabled: !!session && !!documentId && access.hasModule('projects'),
    staleTime: 30_000,
  })
}
