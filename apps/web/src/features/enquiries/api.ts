import { useInfiniteQuery } from '@tanstack/react-query'
import { enquiryList, type EnquiryStatus } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

export function useEnquiries(filters: {
  status?: EnquiryStatus | null
  search?: string
  source?: string | null
  from?: string | null
  to?: string | null
}) {
  const { session } = useAuth()
  const access = useAccess()
  const base = new URLSearchParams()
  if (filters.status) base.set('status', filters.status)
  if (filters.search?.trim()) base.set('search', filters.search.trim())
  if (filters.source?.trim()) base.set('source', filters.source.trim())
  if (filters.from?.trim()) base.set('from', filters.from.trim())
  if (filters.to?.trim()) base.set('to', filters.to.trim())
  const qs = base.toString()
  return useInfiniteQuery({
    queryKey: ['enquiries', qs],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(qs)
      if (pageParam) params.set('cursor', pageParam)
      const suffix = params.toString()
      return callApi(`/enquiries${suffix ? `?${suffix}` : ''}`, { responseSchema: enquiryList })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!session && access.hasModule('crm'),
    staleTime: 15_000,
  })
}
