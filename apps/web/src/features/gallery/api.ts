import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { galleryOpenLink, projectGallery } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'

/** A project's gallery in Frameline, the gallery add-on (0261). */
const key = (projectId: string) => ['projects', projectId, 'gallery'] as const

export function useProjectGallery(projectId: string) {
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => callApi(`/projects/${projectId}/gallery`, { responseSchema: projectGallery }),
    // The photo count moves while the studio uploads in the other tab.
    staleTime: 30_000,
  })
}

export function useCreateGallery(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => callApi(`/projects/${projectId}/gallery`, { method: 'POST', body: {}, responseSchema: projectGallery }),
    onSuccess: (g) => {
      qc.setQueryData(key(projectId), g)
      toast.success('Gallery ready. Open it to upload the photos.')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/**
 * Opens Frameline signed in as this person, at this project's gallery.
 *
 * The window is opened at the press, before the link is asked for, because a
 * browser blocks a window opened after a wait; the link is good for a minute
 * and once, so it is never fetched ahead of the press.
 */
export function useOpenGallery(projectId: string) {
  return useMutation({
    mutationFn: async () => {
      const w = window.open('', '_blank')
      try {
        const { url } = await callApi(`/projects/${projectId}/gallery/open`, { method: 'POST', body: {}, responseSchema: galleryOpenLink })
        if (w) {
          w.opener = null
          w.location.href = url
        } else {
          window.location.href = url
        }
      } catch (e) {
        w?.close()
        throw e
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
