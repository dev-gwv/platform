import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  designCreated,
  designDeleted,
  designDetail,
  designLink,
  designSaved,
  designSummary,
  designWriteReply,
  publicDesign,
  designLibraryPhoto,
  type AddDesignPhotoRequest,
  type DesignLibraryPhoto,
  type CreateDesignRequest,
  type DesignWriteRequest,
  type UpdateDesignRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'

/** Quotation Designer (0295): the studio's designs. */
const KEY = ['designs'] as const

export function useDesigns() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/designs', { responseSchema: designSummary.array() }),
  })
}

export function useDesign(id: string) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => callApi(`/designs/${id}`, { responseSchema: designDetail }),
    // The editor owns the document once open; a refetch would overwrite typing.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useCreateDesign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateDesignRequest) =>
      callApi('/designs', { method: 'POST', body, responseSchema: designCreated }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY, exact: true }),
  })
}

export function useSaveDesign(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateDesignRequest) =>
      callApi(`/designs/${id}`, { method: 'PATCH', body, responseSchema: designSaved }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY, exact: true }),
  })
}

export function useDuplicateDesign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/designs/${id}/duplicate`, { method: 'POST', responseSchema: designCreated }),
    // Designs and templates both: either can be copied or deleted.
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY, refetchType: 'active' }),
  })
}

export function useDeleteDesign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/designs/${id}`, { method: 'DELETE', responseSchema: designDeleted }),
    // Designs and templates both: either can be copied or deleted.
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY, refetchType: 'active' }),
  })
}

// ── step 2 (0296): the client's link and "Write it for me" ──────────

export function useDesignLink(id: string) {
  return useQuery({
    queryKey: [...KEY, id, 'link'],
    queryFn: () => callApi(`/designs/${id}/link`, { responseSchema: designLink }),
  })
}

export function useMakeDesignLink(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      callApi(`/designs/${id}/link`, { method: 'POST', responseSchema: designLink }),
    onSuccess: (l) => qc.setQueryData([...KEY, id, 'link'], l),
  })
}

export function useStopDesignLink(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      callApi(`/designs/${id}/link`, { method: 'DELETE', responseSchema: designLink }),
    onSuccess: (l) => qc.setQueryData([...KEY, id, 'link'], l),
  })
}

export function useWriteDesign() {
  return useMutation({
    mutationFn: (body: DesignWriteRequest) =>
      callApi('/designs/write', { method: 'POST', body, responseSchema: designWriteReply }),
  })
}

/** The client's page reads the design by its link. */
export function usePublicDesign(token: string) {
  return useQuery({
    queryKey: ['public-design', token],
    queryFn: () =>
      callApi(`/public/designs/${encodeURIComponent(token)}`, { responseSchema: publicDesign }),
    retry: false,
    staleTime: 60_000,
  })
}

/** "/d/<token>" on this site: what the studio sends. */
export const designLinkUrl = (token: string) => `${window.location.origin}/d/${token}`

// ── step 3 (0297): saved templates and the photo library ────────────

export function useDesignTemplates() {
  return useQuery({
    queryKey: [...KEY, 'templates'],
    queryFn: () => callApi('/designs?templates=1', { responseSchema: designSummary.array() }),
  })
}

/** Save a design's pages and look as a template of the studio's own. */
export function useSaveAsTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; template: string; doc: CreateDesignRequest['doc'] }) =>
      callApi('/designs', {
        method: 'POST',
        body: { ...body, is_template: true, project_id: null },
        responseSchema: designCreated,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...KEY, 'templates'] }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/designs/${id}`, { method: 'DELETE', responseSchema: designDeleted }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...KEY, 'templates'] }),
  })
}

export function useDesignPhotos() {
  return useQuery({
    queryKey: [...KEY, 'photos'],
    queryFn: () => callApi('/designs/photos', { responseSchema: designLibraryPhoto.array() }),
  })
}

export function useAddDesignPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AddDesignPhotoRequest) =>
      callApi('/designs/photos', { method: 'POST', body, responseSchema: designLibraryPhoto }),
    onSuccess: (p) =>
      qc.setQueryData([...KEY, 'photos'], (old: DesignLibraryPhoto[] | undefined) => [
        p,
        ...(old ?? []),
      ]),
  })
}

export function useRemoveDesignPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/designs/photos/${id}`, { method: 'DELETE', responseSchema: designDeleted }),
    onSuccess: (_r, id) =>
      qc.setQueryData([...KEY, 'photos'], (old: DesignLibraryPhoto[] | undefined) =>
        (old ?? []).filter((p) => p.id !== id),
      ),
  })
}
