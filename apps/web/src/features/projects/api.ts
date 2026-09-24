import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import {
  projectBilling,
  createProjectRequest,
  deliverableSet,
  myDeliverable,
  issuedLink,
  projectDetail,
  projectListItem,
  projectListPage,
  type CreateProjectRequest,
  type DeliverableInput,
  type IssueQuotationRequest,
  type PaymentInput,
  type SaveDeliverableSetRequest,
  type SetDeliverableStageRequest,
  type UpdateDeliverableRequest,
  type UpdatePaymentRequest,
  type UpdateProjectRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { invalidateMoney } from '@/features/billing/invalidate'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const projectsList = projectListItem.array()
const createResponse = z.object({ id: z.string().uuid() })

export type ProjectsQuery = { page?: number; page_size?: number; status?: string; search?: string; sort?: string }

export function useProjects(query?: ProjectsQuery) {
  const { session } = useAuth()
  const access = useAccess()
  const hasParams = !!query && Object.keys(query).length > 0
  return useQuery({
    queryKey: ['projects', query ?? {}],
    queryFn: async () => {
      if (!hasParams) return callApi('/projects', { responseSchema: projectsList })
      const params = new URLSearchParams()
      if (query.page) params.set('page', String(query.page))
      if (query.page_size) params.set('page_size', String(query.page_size))
      if (query.status) params.set('status', query.status)
      if (query.search) params.set('search', query.search)
      if (query.sort) params.set('sort', query.sort)
      const page = await callApi(`/projects?${params.toString()}`, { responseSchema: projectListPage })
      return page.items
    },
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
}

export function useProjectsPage(query: Required<Pick<ProjectsQuery, 'page' | 'page_size'>> & ProjectsQuery) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['projects', 'page', query],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set('page', String(query.page))
      params.set('page_size', String(query.page_size))
      if (query.status) params.set('status', query.status)
      if (query.search) params.set('search', query.search)
      if (query.sort) params.set('sort', query.sort)
      return callApi(`/projects?${params.toString()}`, { responseSchema: projectListPage })
    },
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
}

export function useProject(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['projects', id],
    queryFn: () => callApi(`/projects/${id}`, { responseSchema: projectDetail }),
    enabled: !!session && !!id,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectRequest) =>
      callApi('/projects', {
        method: 'POST',
        body: createProjectRequest.parse(input),
        responseSchema: createResponse,
      }),
    onSuccess: () => {
      toast.success('Project created')
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

const anySchema = z.any()

/** Invalidate both the detail and the list after a project mutation. */
function useProjectMutation(id: string, message: string) {
  const qc = useQueryClient()
  return () => {
    toast.success(message)
    void qc.invalidateQueries({ queryKey: ['projects', id] })
    // Money moved: invoices, payments, profit and the Billing overview read it too.
    invalidateMoney(qc)
  }
}

export function useUpdateProject(id: string) {
  return useMutation({
    mutationFn: (input: UpdateProjectRequest) =>
      callApi(`/projects/${id}`, { method: 'PATCH', body: input, responseSchema: anySchema }),
    onSuccess: useProjectMutation(id, 'Project updated'),
  })
}

export function useAddDeliverable(id: string) {
  return useMutation({
    mutationFn: (input: DeliverableInput) =>
      callApi(`/projects/${id}/deliverables`, { method: 'POST', body: input, responseSchema: anySchema }),
    onSuccess: useProjectMutation(id, 'Deliverable added'),
  })
}

export function useUpdateDeliverable(id: string) {
  return useMutation({
    mutationFn: ({ deliverableId, patch }: { deliverableId: string; patch: UpdateDeliverableRequest }) =>
      callApi(`/projects/${id}/deliverables/${deliverableId}`, { method: 'PATCH', body: patch, responseSchema: anySchema }),
    onSuccess: useProjectMutation(id, 'Deliverable updated'),
  })
}

export function useDeleteDeliverable(id: string) {
  return useMutation({
    mutationFn: (deliverableId: string) =>
      callApi(`/projects/${id}/deliverables/${deliverableId}`, {
        method: 'DELETE',
        responseSchema: anySchema,
      }),
    onSuccess: useProjectMutation(id, 'Deliverable removed'),
  })
}

/** Deliverables the signed-in person is the editor on. */
export function useMyDeliverables() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['projects', 'my-deliverables'],
    queryFn: () => callApi('/projects/deliverables/mine', { responseSchema: myDeliverable.array() }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

/** Move a deliverable to a stage (with the link sent); the editor on it may too. */
export function useSetDeliverableStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ deliverableId, ...body }: { deliverableId: string } & SetDeliverableStageRequest) =>
      callApi(`/projects/deliverables/${deliverableId}/stage`, { method: 'POST', body, responseSchema: anySchema }),
    onSuccess: (_d, v) => {
      toast.success('Deliverable updated')
      void qc.invalidateQueries({ queryKey: ['projects'] })
      // The move is written into the deliverable's timeline too.
      void qc.invalidateQueries({ queryKey: ['deliverable-notes', v.deliverableId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAddPayment(id: string) {
  return useMutation({
    mutationFn: (input: PaymentInput) =>
      callApi(`/projects/${id}/payments`, { method: 'POST', body: input, responseSchema: anySchema }),
    onSuccess: useProjectMutation(id, 'Payment recorded'),
  })
}

/** Change a payment -- most often "promised" becoming "received". */
export function useUpdatePayment(id: string) {
  return useMutation({
    mutationFn: ({ paymentId, patch }: { paymentId: string; patch: UpdatePaymentRequest }) =>
      callApi(`/projects/${id}/payments/${paymentId}`, { method: 'PATCH', body: patch, responseSchema: anySchema }),
    onSuccess: useProjectMutation(id, 'Payment updated'),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeletePayment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paymentId: string) =>
      callApi(`/projects/${id}/payments/${paymentId}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Payment removed')
      invalidateMoney(qc)
    },
  })
}

export function useUpdateQuotation(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { quotation_terms?: string | null; quotation_display_prefs?: Record<string, boolean>; show_quotation?: boolean }) =>
      callApi(`/projects/${id}/quotation`, { method: 'PATCH', body: input, responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Quotation saved')
      void qc.invalidateQueries({ queryKey: ['projects', id] })
    },
  })
}

const boardDeliverable = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  board_status: z.string().nullable().default(null),
  project_id: z.string().uuid().nullable(),
  project_name: z.string().nullable(),
  due_date: z.string().nullable().default(null),
  shoot_name: z.string().nullable().default(null),
  assignee_name: z.string().nullable().default(null),
})
export type BoardDeliverable = z.infer<typeof boardDeliverable>

export function useBoardDeliverables() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['projects', 'board-deliverables'],
    queryFn: () => callApi('/projects/board/deliverables', { responseSchema: boardDeliverable.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 30_000,
  })
}

// ── Shoot types catalog ──
const shootTypeItem = z.object({ id: z.string().uuid(), name: z.string(), category: z.string().nullable().default(null), usage_count: z.number().int().default(0), is_archived: z.boolean().default(false) })

export function useShootTypes() {
  const { session } = useAuth()
  return useQuery({ queryKey: ['catalog', 'shoot-types'], queryFn: () => callApi('/projects/catalog/shoot-types', { responseSchema: shootTypeItem.array() }), enabled: !!session, staleTime: 60_000 })
}
export function useCreateShootType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; category?: string }) => callApi('/projects/catalog/shoot-types', { method: 'POST', body: input, responseSchema: shootTypeItem }),
    onSuccess: () => { toast.success('Shoot type added'); void qc.invalidateQueries({ queryKey: ['catalog', 'shoot-types'] }) },
  })
}
const setsList = deliverableSet.array()

/**
 * The packages this studio quotes from, shared with the whole team.
 *
 * Sets live on the server precisely because they are a shared decision — what
 * "Premium" includes is the studio's answer, not one laptop's. (The lead-time
 * memory beside them on the same step is the opposite, and stays local.)
 */
export function useDeliverableSets() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['projects', 'deliverable-sets'],
    queryFn: () => callApi('/projects/deliverable-sets', { responseSchema: setsList }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 5 * 60_000,
  })
}

export function useSaveDeliverableSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveDeliverableSetRequest) =>
      callApi('/projects/deliverable-sets', {
        method: 'POST',
        body: input,
        responseSchema: deliverableSet,
      }),
    onSuccess: (saved) => {
      toast.success(`Saved “${saved.name}”`)
      void qc.invalidateQueries({ queryKey: ['projects', 'deliverable-sets'] })
    },
  })
}

export function useDeleteDeliverableSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/projects/deliverable-sets/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Set removed')
      void qc.invalidateQueries({ queryKey: ['projects', 'deliverable-sets'] })
    },
  })
}

/**
 * Turn a project into a quotation link.
 *
 * Shared by the project page and the "what next?" dialog the wizard shows, so
 * a quotation issued from either place is built the same way — the server
 * snapshots the prices, and what comes back is the link to send.
 */
export function useIssueQuotation() {
  return useMutation({
    mutationFn: (input: IssueQuotationRequest) =>
      callApi('/documents/quotations', {
        method: 'POST',
        body: input,
        responseSchema: issuedLink,
      }),
  })
}

/**
 * Delete a project. Refused by the API once payments exist, so the error it
 * throws is the message worth showing.
 */
export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/projects/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Project deleted')
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

/** The agreed payment plan and (with Billing access) the project's invoices. */
export function useProjectBilling(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['projects', id, 'billing'],
    queryFn: () => callApi(`/projects/${id}/billing`, { responseSchema: projectBilling }),
    enabled: !!session && !!id,
    staleTime: 15_000,
  })
}
