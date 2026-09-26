import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  clientPortalIssued,
  clientPortalLinkInfo,
  clientPortalStatus,
  z,
  type CreateClientPortalLinkRequest,
  type UpdateClientPortalLinkRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const key = (projectId: string) => ['client-portal', projectId] as const
const ok = z.object({ ok: z.boolean() })

/** The project's live client link (never the raw link) and the latest notes. */
export function useClientPortal(projectId: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => callApi(`/client-portal/projects/${projectId}`, { responseSchema: clientPortalStatus }),
    enabled: !!session && !!projectId && access.hasAction('projects', 'view'),
    staleTime: 30_000,
  })
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export function useCreateClientPortalLink(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateClientPortalLinkRequest) =>
      callApi(`/client-portal/projects/${projectId}`, { method: 'POST', body, responseSchema: clientPortalIssued }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(projectId) }),
    onError: (e) => toast.error(errorText(e, 'We could not make the link.')),
  })
}

export function useUpdateClientPortalLink(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateClientPortalLinkRequest) =>
      callApi(`/client-portal/projects/${projectId}`, { method: 'PATCH', body, responseSchema: clientPortalLinkInfo }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(projectId) }),
    onError: (e) => toast.error(errorText(e, 'We could not save that.')),
  })
}

export function useRevokeClientPortalLink(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => callApi(`/client-portal/projects/${projectId}`, { method: 'DELETE', responseSchema: ok }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(projectId) })
      toast.success('Link stopped. The client can no longer open it.')
    },
    onError: (e) => toast.error(errorText(e, 'We could not stop the link.')),
  })
}
