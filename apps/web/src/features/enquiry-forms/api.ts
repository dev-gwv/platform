import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  enquiryForm,
  enquiryFormLead,
  type CreateEnquiryFormRequest,
  type UpdateEnquiryFormRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const KEY = ['enquiry-forms'] as const

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
    onError: (e) => toast.error(errorText(e, 'We could not save that.')),
  })
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
