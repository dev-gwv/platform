import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  fbConnectUrlResponse,
  fbImportsSummary,
  fbLeadImport,
  fbPage,
  fbStatusResponse,
  z,
  type FbPageConnectRequest,
  type FbTestImportRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const pages = fbPage.array()
const noContent = z.any()

/** The import log comes back as rows plus a summary computed over the whole set. */
const importsResponse = z.object({
  items: fbLeadImport.array(),
  summary: fbImportsSummary,
})
export type FbImportsResponse = z.infer<typeof importsResponse>

function useMetaQuery<T>(key: readonly unknown[], fn: () => Promise<T>, staleTime = 30_000) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['meta', ...key],
    queryFn: fn,
    enabled: !!session && access.hasModule('lead_sources'),
    staleTime,
  })
}

export const useMetaStatus = () =>
  useMetaQuery(['status'], () => callApi('/meta/status', { responseSchema: fbStatusResponse }))

export const useMetaConnectUrl = () =>
  useMetaQuery(['connect-url'], () => callApi('/meta/connect-url', { responseSchema: fbConnectUrlResponse }), 5 * 60_000)

export const useMetaPages = () => useMetaQuery(['pages'], () => callApi('/meta/pages', { responseSchema: pages }))

function useMetaMutation<TInput, TOutput>(fn: (input: TInput) => Promise<TOutput>, success?: (out: TOutput) => string) {
  const qc = useQueryClient()
  return useMutation<TOutput, Error, TInput>({
    mutationFn: fn,
    onSuccess: (out) => {
      if (success) toast.success(success(out))
      void qc.invalidateQueries({ queryKey: ['meta'] })
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export const useConnectPage = () =>
  useMetaMutation(
    (input: FbPageConnectRequest) =>
      callApi('/meta/pages/connect', { method: 'POST', body: input, responseSchema: fbPage }),
    (p) => `${p.page_name} connected`,
  )

export const useDisconnectPage = () =>
  useMetaMutation<string, unknown>(
    (id: string) => callApi(`/meta/pages/${id}/disconnect`, { method: 'POST', responseSchema: noContent }),
    () => 'Page disconnected',
  )

const imported = z.object({ ok: z.boolean(), imported: z.number().int() })
const pagesFound = (r: { imported: number }) =>
  r.imported === 0 ? 'Facebook found no pages you manage' : `${r.imported} page${r.imported === 1 ? '' : 's'} found — pick the ones that run lead forms`

/**
 * The manual token path, for a studio without the Facebook login button. The
 * token is checked against Meta and the pages it manages are kept, each
 * with its own sealed token; the pasted token itself is not.
 */
export const useVerifyMetaToken = () =>
  useMetaMutation((token: string) => callApi('/meta/token', { method: 'POST', body: { token }, responseSchema: imported }), pagesFound)

/** "Connect with Facebook" sent the browser back with ?code=; the server trades it for the pages. */
export const useExchangeMetaCode = () =>
  useMetaMutation((code: string) => callApi('/meta/exchange', { method: 'POST', body: { code }, responseSchema: imported }), pagesFound)

export interface ImportLogFilters {
  search?: string
  status?: string
  page?: string
  dateFrom?: string
  dateTo?: string
  sort?: 'newest' | 'oldest'
}

export function useImportLog(sourceId: string | null, f: ImportLogFilters = {}) {
  const { session } = useAuth()
  const access = useAccess()
  const p = new URLSearchParams()
  if (f.search) p.set('search', f.search)
  if (f.status) p.set('status', f.status)
  if (f.page) p.set('page', f.page)
  if (f.dateFrom) p.set('date_from', new Date(f.dateFrom).toISOString())
  if (f.dateTo) p.set('date_to', new Date(f.dateTo).toISOString())
  if (f.sort) p.set('sort', f.sort)
  const qs = p.toString()
  return useQuery({
    queryKey: ['meta', 'imports', sourceId, f],
    queryFn: () =>
      callApi(`/crm/sources/${sourceId}/leads${qs ? `?${qs}` : ''}`, { responseSchema: importsResponse }),
    enabled: !!session && !!sourceId && access.hasModule('lead_sources'),
    staleTime: 15_000,
  })
}

export const useCreateTestLead = (sourceId: string) =>
  useMetaMutation(
    (input: FbTestImportRequest) =>
      callApi(`/crm/sources/${sourceId}/leads/test`, { method: 'POST', body: input, responseSchema: z.any() }),
    () => 'Test lead sent through the source',
  )

/** Re-run one failed import without asking Meta to resend it. */
export const useRetryImport = (sourceId: string) =>
  useMetaMutation<string, unknown>(
    (importId: string) =>
      callApi(`/crm/sources/${sourceId}/leads/${importId}/retry`, { method: 'POST', responseSchema: z.any() }),
    () => 'Retried',
  )
