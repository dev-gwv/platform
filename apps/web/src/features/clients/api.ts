import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z, client, projectListItem, createClientRequest, updateClientRequest, type Client, type CreateClientRequest, type UpdateClientRequest } from '@ipc/contracts'
import { ApiError } from '@/shared/api/client'

const noContent = z.unknown()
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const clientsList = client.array()
const clientPage = z.object({ items: clientsList, total: z.number().int(), page: z.number().int(), page_size: z.number().int() })
type ClientPage = z.infer<typeof clientPage>

interface ClientDirectoryQuery {
  search?: string
  sort?: 'recent' | 'name' | 'city'
  /** Client-side filter (free-text tag); the server only filters search/sort. */
  relation?: string
  /** YYYY-MM-DD range on created_at, applied by the database. */
  created_from?: string
  created_to?: string
  page?: number
  page_size?: number
}

/** Legacy array shape (no params) — kept for existing callers. */
export function useClients(query?: ClientDirectoryQuery) {
  const { session } = useAuth()
  const access = useAccess()
  const hasParams = !!query && Object.keys(query).length > 0
  return useQuery({
    queryKey: ['clients', query ?? {}],
    queryFn: async (): Promise<Client[] | ClientPage> => {
      if (!hasParams) return callApi('/clients', { responseSchema: clientsList })
      const q = query ?? {}
      const params = new URLSearchParams()
      params.set('page', String(q.page ?? 1))
      params.set('page_size', String(q.page_size ?? 25))
      if (q.search?.trim()) params.set('search', q.search.trim())
      if (q.sort) params.set('sort', q.sort)
      // These three used to be applied here, to the page that had already come
      // back -- so they narrowed 25 rows while the pager went on counting all
      // of them. The database applies them now, and the count agrees.
      if (q.relation?.trim()) params.set('relation', q.relation.trim())
      if (q.created_from?.trim()) params.set('created_from', q.created_from.trim())
      if (q.created_to?.trim()) params.set('created_to', q.created_to.trim())
      return callApi(`/clients?${params.toString()}`, { responseSchema: clientPage })
    },
    enabled: !!session && access.hasModule('clients'),
    staleTime: 30_000,
  })
}

export function useClient(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['clients', id],
    queryFn: () => callApi(`/clients/${id}`, { responseSchema: client }),
    enabled: !!session && !!id,
  })
}

export function useClientProjects(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['clients', id, 'projects'],
    queryFn: () => callApi(`/clients/${id}/projects`, { responseSchema: projectListItem.array() }),
    enabled: !!session && !!id,
  })
}

export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateClientRequest) =>
      callApi('/clients', {
        method: 'POST',
        body: createClientRequest.parse(input),
        responseSchema: client,
      }).catch((err) => {
        // 409 duplicate-by-phone: surface the existing client with a link.
        if (err instanceof ApiError && err.status === 409) {
          try {
            const body = JSON.parse(err.message) as { existing_client?: unknown }
            void body
          } catch { /* message is already human-readable */ }
        }
        throw err
      }),
    onSuccess: () => {
      toast.success('Client added')
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.error('A client with this phone already exists. Open the existing client instead.', { action: { label: 'View clients', onClick: () => { window.location.hash = '#/clients' } } })
      }
    },
  })
}

/** Same endpoint shape whether this is the first save or the fifth. */
export function useUpdateClient(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateClientRequest) =>
      callApi(`/clients/${id}`, {
        method: 'PATCH',
        body: updateClientRequest.parse(input),
        responseSchema: client,
      }),
    onSuccess: () => {
      toast.success('Client updated')
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

export function useDeleteClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/clients/${id}`, { method: 'DELETE', responseSchema: noContent }),
    onSuccess: () => {
      toast.success('Client deleted')
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}
