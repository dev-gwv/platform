import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const termsDocument = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  has_active_link: z.boolean(),
  link_expires_at: z.string().nullable(),
  created_at: z.string(),
})
export type TermsDocument = z.infer<typeof termsDocument>
const list = termsDocument.array()

const issued = z.object({ document_id: z.string().uuid(), token: z.string() })

/** What the server answers after making (and maybe emailing) a link. */
const sentLink = z.object({
  document_id: z.string().uuid(),
  token: z.string(),
  url: z.string(),
  email_status: z.enum(['sent', 'provider_missing', 'failed', 'not_requested']),
  email_error: z.string().nullable(),
})
export type SentLink = z.infer<typeof sentLink>

/** One version of a project's terms. */
export const projectTermsVersion = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  acknowledged_by_email: z.string().nullable(),
  access_count: z.number().int(),
  link_live: z.boolean(),
  emailed_to: z.string().nullable(),
})
export type ProjectTermsVersion = z.infer<typeof projectTermsVersion>

/** Every version of this project's terms, newest first. */
export function useProjectTerms(projectId: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['terms', 'project', projectId],
    queryFn: () => callApi(`/terms/projects/${projectId}/documents`, { responseSchema: projectTermsVersion.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 15_000,
  })
}

const invalidateTerms = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['terms'] })
}

/** Make the terms for a project and its link -- and email it, if asked. */
export function useSendNewTerms() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: IssueTermsInput & { email?: boolean; to_email?: string | null }) =>
      callApi('/terms/issue', { method: 'POST', body: input, responseSchema: sentLink }),
    onSuccess: () => invalidateTerms(qc),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** A fresh link for terms already sent (the old one stops working). */
export function useSendTermsAgain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, ...body }: { documentId: string; email?: boolean; to_email?: string | null; expiry_days?: number }) =>
      callApi(`/terms/documents/${documentId}/link`, { method: 'POST', body, responseSchema: sentLink }),
    onSuccess: () => invalidateTerms(qc),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Stop a link working. */
export function useCancelTerms() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      callApi(`/terms/documents/${documentId}/revoke`, { method: 'POST', responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Link cancelled — it no longer opens')
      invalidateTerms(qc)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteTermsTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/terms/templates/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Template removed')
      void qc.invalidateQueries({ queryKey: ['terms', 'templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Every project's paperwork, newest document first per project. */
export function useTermsDocuments() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['terms', 'documents'],
    queryFn: () => callApi('/terms/documents', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 15_000,
  })
}

export const termsTemplate = z.object({
  id: z.string().uuid(),
  name: z.string(),
  body: z.string(),
  version: z.number().int(),
  created_at: z.string(),
})
export type TermsTemplate = z.infer<typeof termsTemplate>

/** The studio's saved starting points for a terms document. */
export function useTermsTemplates() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['terms', 'templates'],
    queryFn: () => callApi('/terms/templates', { responseSchema: termsTemplate.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 60_000,
  })
}

export function useSeedTermsTemplates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      callApi('/terms/templates/seed', { method: 'POST', responseSchema: z.object({ seeded: z.number() }) }),
    onSuccess: (r) => {
      toast.success(r.seeded ? `Added ${r.seeded} template${r.seeded === 1 ? '' : 's'}` : 'You already have all three')
      void qc.invalidateQueries({ queryKey: ['terms', 'templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSaveTermsTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; body: string }) =>
      callApi('/terms/templates', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
    onSuccess: () => {
      toast.success('Template saved')
      void qc.invalidateQueries({ queryKey: ['terms', 'templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** One instalment of the schedule the client is agreeing to. */
export interface PaymentTermDraft {
  label: string
  mode: 'percent' | 'amount'
  value: number
  due_trigger?: string | undefined
  notes?: string | undefined
}

export interface IssueTermsInput {
  project_id: string | null
  rendered_body: string
  title?: string | undefined
  payment_summary?: string | undefined
  payment_terms?: PaymentTermDraft[] | undefined
  total_cost?: number | undefined
  legal_note?: string | undefined
  expiry_days?: number | undefined
}

/** Issuing again replaces the active link for that project — the old one still shows in history. */
export function useIssueTerms() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: IssueTermsInput) =>
      callApi('/terms/issue', { method: 'POST', body: input, responseSchema: issued }),
    onSuccess: (_d, v) => {
      toast.success('Terms link issued')
      void qc.invalidateQueries({ queryKey: ['terms', 'documents'] })
      // The server clears the draft on issue; drop our copy so reopening the
      // wizard does not offer to resume something already sent.
      if (v.project_id) void qc.invalidateQueries({ queryKey: ['terms', 'draft', v.project_id] })
    },
  })
}

/**
 * A terms sheet saved part-way through. One per project: "save draft" means
 * "keep where I am", not "keep every version of where I have been".
 */
export const termsDraft = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  rendered_body: z.string(),
  title: z.string().nullable(),
  payment_summary: z.string().nullable(),
  sections: z.array(z.record(z.string(), z.unknown())).nullable(),
  payment_terms: z.array(z.record(z.string(), z.unknown())).nullable(),
  total_cost: z.number().nullable(),
  legal_note: z.string().nullable(),
  template_id: z.string().uuid().nullable(),
  updated_at: z.string().nullable(),
})
export type TermsDraft = z.infer<typeof termsDraft>

export function useTermsDraft(projectId: string | null) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['terms', 'draft', projectId],
    // Null is the ordinary answer, not a failure — most projects have no draft.
    queryFn: () => callApi(`/terms/draft?project_id=${projectId}`, { responseSchema: termsDraft.nullable() }),
    enabled: !!session && !!projectId && access.hasModule('projects'),
    staleTime: 10_000,
  })
}

export function useSaveTermsDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Record<string, unknown> & { project_id: string }) =>
      callApi('/terms/draft', { method: 'PUT', body: input, responseSchema: termsDraft }),
    onSuccess: (_d, v) => {
      toast.success('Draft saved')
      void qc.invalidateQueries({ queryKey: ['terms', 'draft', v.project_id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/**
 * Keep the half-written terms as the owner types -- no button, no toast.
 * A failed save is quiet too: the text is still on screen, and the next
 * keystroke tries again.
 */
export function useAutosaveTermsDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      project_id: string
      rendered_body: string
      title: string | null
      payment_terms: PaymentTermDraft[]
      total_cost: number | null
    }) => callApi('/terms/draft', { method: 'PUT', body: input, responseSchema: termsDraft }),
    onSuccess: (d, v) => qc.setQueryData(['terms', 'draft', v.project_id], d),
    meta: { silent: true },
  })
}

export function useDiscardTermsDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) =>
      callApi(`/terms/draft?project_id=${projectId}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: (_d, projectId) => {
      toast.success('Draft discarded')
      void qc.invalidateQueries({ queryKey: ['terms', 'draft', projectId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** What was emailed for one document, and whether it actually went. */
export const termsEmailLog = z.object({
  id: z.string().uuid(),
  to_email: z.string().nullable(),
  status: z.string(),
  error: z.string().nullable(),
  created_at: z.string(),
})
export type TermsEmailLog = z.infer<typeof termsEmailLog>

/**
 * The send history behind a terms document. "I sent it, they say it never
 * arrived" is otherwise unanswerable — the log records the address, the
 * outcome and the provider's error.
 */
export function useTermsEmailLogs(documentId: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['terms', 'email-logs', documentId],
    queryFn: () =>
      callApi(`/terms/documents/${documentId}/email-logs`, { responseSchema: termsEmailLog.array() }),
    enabled: !!session && !!documentId,
    staleTime: 15_000,
  })
}

/** Email a link the studio already holds, without replacing it. */
export function useEmailTermsLink() {
  return useMutation({
    mutationFn: ({ documentId, token, to_email }: { documentId: string; token: string; to_email?: string | null }) =>
      callApi(`/terms/documents/${documentId}/email`, {
        method: 'POST',
        body: { token, to_email: to_email || null },
        responseSchema: z.object({ status: z.string(), error: z.string().nullable() }),
      }),
    onError: (e: Error) => toast.error(e.message),
  })
}
