import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  driveExpand,
  driveImport,
  driveImports,
  drivePicker,
  framelineAccount,
  galleryList,
  galleryOpenLink,
  projectGallery,
  type DriveImportRequest,
} from '@ipc/contracts'
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

/** `inDrive`: keep the gallery's full-size photos in the studio's Google Drive (offered once Drive is connected). */
export function useCreateGallery(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (opts: { inDrive?: boolean } = {}) =>
      callApi(`/projects/${projectId}/gallery`, {
        method: 'POST',
        body: opts.inDrive === undefined ? {} : { originals_in: opts.inDrive ? 'drive' : 'frameline' },
        responseSchema: projectGallery,
      }),
    onSuccess: (g) => {
      qc.setQueryData(key(projectId), g)
      // The made gallery comes back without the studio's Drive state: read the tab again so
      // Import from Google Drive and the Drive line show straight away, not after a reload.
      void qc.invalidateQueries({ queryKey: key(projectId) })
      toast.success('Gallery ready. Open it to upload the photos.')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/**
 * Opens Frameline signed in as this person, at this project's gallery, or
 * (`'import'`) at its Import from Google Drive window.
 *
 * The window is opened at the press, before the link is asked for, because a
 * browser blocks a window opened after a wait; the link is good for a minute
 * and once, so it is never fetched ahead of the press.
 */
export function useOpenGallery(projectId: string) {
  return useOpenFrameline<'gallery' | 'import'>(`/projects/${projectId}/gallery/open`)
}

/** Projects → Galleries: every project with a gallery. */
export function useGalleries() {
  return useQuery({
    queryKey: ['galleries'],
    queryFn: () => callApi('/galleries', { responseSchema: galleryList }),
    staleTime: 30_000,
  })
}

/** Settings → Messaging → Gallery: the Frameline studio, the owner's. */
export function useFramelineAccount() {
  return useQuery({
    queryKey: ['galleries', 'account'],
    queryFn: () => callApi('/galleries/account', { responseSchema: framelineAccount }),
    staleTime: 60_000,
  })
}

/** "Open Frameline": the owner signed in, on Frameline's home, or (`'drive'`) its Google Drive settings. */
export function useOpenFramelineHome() {
  return useOpenFrameline<'home' | 'drive'>('/galleries/account/open')
}

/** `mutate()` opens the default place; `mutate(to)` another one the server knows. */
function useOpenFrameline<To extends string>(path: string) {
  return useMutation({
    mutationFn: async (to?: To) => {
      const w = window.open('', '_blank')
      try {
        const { url } = await callApi(path, { method: 'POST', body: to ? { to } : {}, responseSchema: galleryOpenLink })
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

/**
 * Import from Google Drive on the Gallery tab: the picker's token (asked for
 * at the press), what was picked, and the imports Frameline runs.
 */
export const readDrivePicker = (projectId: string) => callApi(`/projects/${projectId}/gallery/drive/picker`, { responseSchema: drivePicker })

export const expandDrive = (projectId: string, ids: string[]) =>
  callApi(`/projects/${projectId}/gallery/drive/expand`, { method: 'POST', body: { ids }, responseSchema: driveExpand })

const importsKey = (projectId: string) => ['projects', projectId, 'gallery', 'drive-imports'] as const

/** The gallery's imports; read every few seconds while one is running. */
export function useDriveImports(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: importsKey(projectId),
    queryFn: () => callApi(`/projects/${projectId}/gallery/drive/imports`, { responseSchema: driveImports }),
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === 'running') ? 4000 : false),
  })
}

export function useStartDriveImport(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DriveImportRequest) =>
      callApi(`/projects/${projectId}/gallery/drive/imports`, { method: 'POST', body, responseSchema: driveImport }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: importsKey(projectId) }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useStopDriveImport(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (importId: string) =>
      callApi(`/projects/${projectId}/gallery/drive/imports/${encodeURIComponent(importId)}`, { method: 'DELETE', responseSchema: driveImport }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: importsKey(projectId) }),
    onError: (e: Error) => toast.error(e.message),
  })
}
