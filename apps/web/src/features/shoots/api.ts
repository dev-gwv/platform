import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  serviceOption,
  shootPreset,
  z,
  type SaveShootPresetRequest,
  type ShootPresetKind,
  type UpdateShootRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const services = serviceOption.array()
const presets = shootPreset.array()
const anySchema = z.any()

/**
 * Every service this studio has on its catalog, for the requirement picker
 * and for Settings → Services. Cached for a while — it changes rarely.
 */
export function useServices() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['shoots', 'services'],
    queryFn: () => callApi('/shoots/services', { responseSchema: services }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 5 * 60_000,
  })
}

function useServiceMutation<TArgs>(fn: (a: TArgs) => Promise<unknown>, message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['shoots', 'services'] })
    },
  })
}

/**
 * Keep a requirement someone typed by hand, the moment they type it.
 *
 * Requirements were only learned when a project was saved, so a custom
 * "Highlight Editor" typed on the first shoot of a new project was not
 * offered back on the second shoot of the same one. Quiet on purpose: this is
 * the picker remembering, not the user doing anything worth a toast. A
 * failure costs the shortcut, never the requirement on the shoot.
 */
export function useRememberService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      callApi('/shoots/services', { method: 'POST', body: { name }, responseSchema: serviceOption }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shoots', 'services'] }),
  })
}

export function useCreateService() {
  return useServiceMutation(
    (name: string) => callApi('/shoots/services', { method: 'POST', body: { name }, responseSchema: serviceOption }),
    'Service added',
  )
}

export function useUpdateService() {
  return useServiceMutation(
    ({ id, name }: { id: string; name: string }) =>
      callApi(`/shoots/services/${id}`, { method: 'PATCH', body: { name }, responseSchema: serviceOption }),
    'Service updated',
  )
}

export function useDeleteService() {
  return useServiceMutation(
    (id: string) => callApi(`/shoots/services/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Service deleted',
  )
}

export function useUpdateShoot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateShootRequest }) =>
      callApi(`/shoots/${id}`, { method: 'PATCH', body: patch, responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Shoot updated')
      void qc.invalidateQueries({ queryKey: ['shoots'] })
    },
  })
}

export function useDeleteShoot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/shoots/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Shoot deleted')
      void qc.invalidateQueries({ queryKey: ['shoots'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useShootPresets(kind: ShootPresetKind) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['shoots', 'presets', kind],
    queryFn: () => callApi(`/shoots/presets?kind=${kind}`, { responseSchema: presets }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 5 * 60_000,
  })
}

export function useSaveShootPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveShootPresetRequest) =>
      callApi('/shoots/presets', { method: 'POST', body: input, responseSchema: shootPreset }),
    onSuccess: (saved) => {
      toast.success(`Saved “${saved.name}”`)
      void qc.invalidateQueries({ queryKey: ['shoots', 'presets'] })
    },
  })
}

export function useDeleteShootPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/shoots/presets/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Preset removed')
      void qc.invalidateQueries({ queryKey: ['shoots', 'presets'] })
    },
  })
}
