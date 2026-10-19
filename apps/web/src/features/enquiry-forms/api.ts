import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  enquiryForm,
  enquiryFormLead,
  enquiryHub,
  enquiryPartner,
  enquiryVendor,
  leadsExportResponse,
  z,
  type CreateEnquiryFormRequest,
  type CreateEnquiryPartnerRequest,
  type UpdateEnquiryFormRequest,
  type UpdateEnquiryPartnerRequest,
} from '@ipc/contracts'
import { ApiError, callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const KEY = ['enquiry-forms'] as const
const PARTNERS = ['enquiry-partners'] as const

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export function useEnquiryForms() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/enquiry-forms', { responseSchema: enquiryForm.array() }),
    enabled: !!session && access.hasModule('crm'),
    staleTime: 30_000,
  })
}

export function useEnquiryForm(id: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => callApi(`/enquiry-forms/${id}`, { responseSchema: enquiryForm }),
    enabled: !!session && !!id && access.hasModule('crm'),
    staleTime: 30_000,
  })
}

export function useEnquiryFormLeads(id: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: [...KEY, id, 'leads'],
    queryFn: () => callApi(`/enquiry-forms/${id}/leads`, { responseSchema: enquiryFormLead.array() }),
    enabled: !!session && !!id && access.hasModule('crm'),
    staleTime: 30_000,
  })
}

export function useCreateEnquiryForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateEnquiryFormRequest) =>
      callApi('/enquiry-forms', { method: 'POST', body, responseSchema: enquiryForm }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errorText(e, 'We could not make the form.')),
  })
}

export function useUpdateEnquiryForm(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateEnquiryFormRequest) =>
      callApi(`/enquiry-forms/${id}`, { method: 'PATCH', body, responseSchema: enquiryForm }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    // A refusal about one box ("Add your WhatsApp number") is shown under it by the screen.
    onError: (e) => {
      if (!fieldOf(e)) toast.error(errorText(e, 'We could not save that.'))
    },
  })
}

/** The field a refusal is about, when the server names one. */
export function fieldOf(e: unknown): string | null {
  const body = e instanceof ApiError ? e.body : null
  return body && typeof body === 'object' && 'field' in body ? String((body as { field: unknown }).field) : null
}

/** Their page: on makes a new link (the old one stops), off stops it. */
export function useEnquiryFormPage(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (on: boolean) =>
      callApi(`/enquiry-forms/${id}/page`, { method: 'POST', body: { on }, responseSchema: enquiryForm }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errorText(e, 'We could not change the page link.')),
  })
}

// ── the main form, partners, vendors, downloads (0274) ────────────
export function useEnquiryHub() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: [...KEY, 'hub'],
    queryFn: () => callApi('/enquiry-forms/hub', { responseSchema: enquiryHub }),
    enabled: !!session && access.hasModule('crm'),
    staleTime: 30_000,
  })
}

export function useSetEnquiryServices() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (values: string[]) =>
      callApi('/enquiry-forms/services', {
        method: 'PUT',
        body: { values },
        responseSchema: z.object({ services: z.array(z.string()) }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errorText(e, 'We could not save the choices.')),
  })
}

export function usePartners(archived = false, enabled = true) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...PARTNERS, archived ? 'archived' : 'live'],
    queryFn: () => callApi(`/enquiry-partners${archived ? '?archived=true' : ''}`, { responseSchema: enquiryPartner.array() }),
    enabled: !!session && enabled,
    staleTime: 30_000,
  })
}

export function usePartner(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...PARTNERS, id],
    queryFn: () => callApi(`/enquiry-partners/${id}`, { responseSchema: enquiryPartner }),
    enabled: !!session && !!id,
    staleTime: 30_000,
  })
}

export function usePartnerLeads(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...PARTNERS, id, 'leads'],
    queryFn: () => callApi(`/enquiry-partners/${id}/leads`, { responseSchema: enquiryFormLead.array() }),
    enabled: !!session && !!id,
    staleTime: 30_000,
  })
}

export function usePartnerVendors(enabled = true) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...PARTNERS, 'vendors'],
    queryFn: () => callApi('/enquiry-partners/vendors', { responseSchema: enquiryVendor.array() }),
    enabled: !!session && enabled,
    staleTime: 30_000,
  })
}

const partnerDone = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: PARTNERS })
  void qc.invalidateQueries({ queryKey: ['parties'] })
}

export function useCreatePartner() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateEnquiryPartnerRequest) =>
      callApi('/enquiry-partners', { method: 'POST', body, responseSchema: enquiryPartner }),
    onSuccess: () => partnerDone(qc),
  })
}

export function useUpdatePartner(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateEnquiryPartnerRequest) =>
      callApi(`/enquiry-partners/${id}`, { method: 'PATCH', body, responseSchema: enquiryPartner }),
    onSuccess: () => partnerDone(qc),
  })
}

/** Their page: on makes a new link (the old one stops at once), off stops sharing. */
export function usePartnerSharing(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (on: boolean) =>
      callApi(`/enquiry-partners/${id}/sharing`, { method: 'POST', body: { on }, responseSchema: enquiryPartner }),
    onSuccess: () => partnerDone(qc),
    onError: (e) => toast.error(errorText(e, 'We could not change the page link.')),
  })
}

/** "Make QR" on a vendor. */
export function useMakeVendorQr() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vendorId: string) =>
      callApi(`/enquiry-partners/from-vendor/${vendorId}`, { method: 'POST', responseSchema: enquiryPartner }),
    onSuccess: () => partnerDone(qc),
    onError: (e) => toast.error(errorText(e, 'We could not make the QR code.')),
  })
}

export type LeadsDownload = { format: 'xlsx' | 'csv'; partner_id?: string; from?: 'form' | 'partner'; source?: string; q?: string }

/** Leads as Excel or CSV: the file is made on the server and saved here. */
export async function downloadLeads(query: LeadsDownload): Promise<number> {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][])
  const res = await callApi(`/leads-export?${qs}`, { responseSchema: leadsExportResponse })
  if (res.rows === 0) return 0
  const bytes = Uint8Array.from(atob(res.data), (ch) => ch.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: res.content_type }))
  const a = document.createElement('a')
  a.href = url
  a.download = res.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return res.rows
}
