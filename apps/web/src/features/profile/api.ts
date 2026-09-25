import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  memberDocument,
  myProfile,
  payTo,
  teamProfileGap,
  z,
  type IdDocumentKind,
  type UpdateMyProfileRequest,
} from '@ipc/contracts'
import { callApi, fetchFileBlob, postForm } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

export const PROFILE_KEY = ['settings', 'profile'] as const
const DOCS_KEY = ['settings', 'profile', 'documents'] as const

export function useMyProfile() {
  const { session } = useAuth()
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => callApi('/settings/profile', { responseSchema: myProfile }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useSaveMyProfile() {
  const qc = useQueryClient()
  const { refresh } = useAuth()
  return useMutation({
    mutationFn: (body: UpdateMyProfileRequest) =>
      callApi('/settings/profile', { method: 'PATCH', body, responseSchema: myProfile }),
    onSuccess: (p) => {
      qc.setQueryData(PROFILE_KEY, p)
      void qc.invalidateQueries({ queryKey: ['team', 'profile-gaps'] })
      void refresh()
      toast.success(p.completeness.percent === 100 ? 'Profile complete. Thank you!' : 'Saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Owner: everyone's profile gaps (field names only). */
export function useTeamProfileGaps() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['team', 'profile-gaps'],
    queryFn: () => callApi('/team/profile-gaps', { responseSchema: teamProfileGap.array() }),
    enabled: !!session?.is_owner,
    staleTime: 60_000,
  })
}

// ── ID proof ─────────────────────────────────────────────────────────────
// Kept apart from ordinary files and readable only by the member and the
// owner. `userId` set means the owner looking at someone else's.

const docsPath = (userId?: string) => (userId ? `/team/members/${userId}/documents` : '/settings/profile/documents')

export function useIdDocuments(userId?: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: userId ? ['team', 'documents', userId] : DOCS_KEY,
    queryFn: () => callApi(docsPath(userId), { responseSchema: memberDocument.array() }),
    enabled: !!session && (!userId || !!session.is_owner),
    staleTime: 60_000,
  })
}

export function useUploadIdDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: IdDocumentKind }) =>
      memberDocument.parse(
        await postForm('/settings/profile/documents', () => {
          const form = new FormData()
          form.append('file', file)
          form.append('kind', kind)
          return form
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DOCS_KEY })
      void qc.invalidateQueries({ queryKey: PROFILE_KEY })
      toast.success('ID proof added')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useRemoveIdDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/settings/profile/documents/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DOCS_KEY })
      void qc.invalidateQueries({ queryKey: PROFILE_KEY })
      toast.success('Removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Open an ID proof in a new tab (the request carries the token; a link cannot). */
export async function openIdDocument(docId: string, userId?: string): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const blob = await fetchFileBlob(`${docsPath(userId)}/${docId}`)
    const url = URL.createObjectURL(blob)
    if (tab) tab.location.href = url
    else window.location.assign(url)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    tab?.close()
    toast.error((e as Error).message)
  }
}

/**
 * Where to send someone's pay -- for whoever pays them (owner, or salaries or
 * payouts edit). The server audits every read.
 */
export function usePayTo(userId: string | null) {
  const { session } = useAuth()
  const access = useAccess()
  const allowed = !!session?.is_owner || access.hasAction('team_salaries', 'edit') || access.hasAction('team_payouts', 'edit')
  return useQuery({
    queryKey: ['team', 'pay-to', userId],
    queryFn: () => callApi(`/team/members/${userId}/pay-to`, { responseSchema: payTo }),
    enabled: !!userId && allowed,
    staleTime: 60_000,
  })
}
