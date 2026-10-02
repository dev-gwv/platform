import { useQuery } from '@tanstack/react-query'
import { companyProfile, companyTheme, type CompanyProfile, type CompanyTheme } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import type { QuotationDocumentData } from './QuotationDocument'

/** The studio's letterhead from its company profile: what invoices and quotations print. */
export function letterheadFrom(company: CompanyProfile | undefined): QuotationDocumentData['studio'] {
  return {
    name: company?.display_name || company?.name || 'Studio',
    legalName: company?.legal_name,
    logoUrl: company?.invoice_logo_url ?? company?.avatar_url,
    gstin: company?.invoice_gst_number,
    phone: company?.invoice_phone,
    email: company?.invoice_email,
    website: company?.website,
    address: company?.invoice_address,
    footerNote: company?.document_footer_note,
  }
}

/** The studio's own colour for the stripe, only when it chose one. */
export const brandColorFrom = (theme: CompanyTheme | undefined) =>
  theme?.is_custom_theme ? (theme.primary_color ?? theme.custom_color ?? null) : null

/** The signed-in studio's letterhead and stripe colour. */
export function useStudioLetterhead() {
  const company = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })
  const theme = useQuery({
    queryKey: ['settings', 'theme'],
    queryFn: () => callApi('/settings/theme', { responseSchema: companyTheme }),
  })
  return { studio: letterheadFrom(company.data), brandColor: brandColorFrom(theme.data) }
}
