import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import {
  dataRecord,
  storageLocation,
  type CreateDataRecordRequest,
  type UpdateDataRecordRequest,
  type CreateStorageLocationRequest,
  type UpdateStorageLocationRequest,
  type SetDataTrackRequest,
} from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const list = dataRecord.array()
const locationList = storageLocation.array()
const anySchema = z.any()

export function useStorageLocations() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['data', 'locations'],
    queryFn: () => callApi('/data/locations', { responseSchema: locationList }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 60_000,
  })
}

export function useCreateStorageLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateStorageLocationRequest) =>
      callApi('/data/locations', { method: 'POST', body: input, responseSchema: storageLocation }),
    onSuccess: () => {
      toast.success('Location added')
      void qc.invalidateQueries({ queryKey: ['data', 'locations'] })
    },
  })
}

export function useUpdateStorageLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateStorageLocationRequest }) =>
      callApi(`/data/locations/${id}`, { method: 'PATCH', body: patch, responseSchema: storageLocation }),
    onSuccess: () => {
      toast.success('Location updated')
      void qc.invalidateQueries({ queryKey: ['data', 'locations'] })
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
  })
}

export function useDeleteStorageLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/data/locations/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Location removed')
      void qc.invalidateQueries({ queryKey: ['data', 'locations'] })
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
  })
}

export function useDataRecords() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['data'],
    queryFn: () => callApi('/data', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 15_000,
  })
}

/** One project's own data records — its detail page's Data tab. */
export function useProjectDataRecords(projectId: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['data', 'project', projectId],
    queryFn: () => callApi(`/data?project_id=${projectId}`, { responseSchema: list }),
    enabled: !!session && access.hasModule('projects') && !!projectId,
    staleTime: 15_000,
  })
}

export function useVerifyData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, track }: { id: string; track: 'primary' | 'backup' }) =>
      callApi(`/data/${id}/verify`, { method: 'POST', body: { track }, responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Verified')
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
  })
}

export function useCreateDataRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateDataRecordRequest) =>
      callApi('/data', { method: 'POST', body: input, responseSchema: dataRecord }),
    onSuccess: () => {
      toast.success('Data saved')
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
  })
}

export function useUpdateDataRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDataRecordRequest }) =>
      callApi(`/data/${id}`, { method: 'PATCH', body: patch, responseSchema: dataRecord }),
    onSuccess: () => {
      toast.success('Record updated')
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
  })
}

/** Move one copy along: pending → copied → verified, or issue / not needed. */
export function useSetDataTrack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: SetDataTrackRequest & { id: string }) =>
      callApi(`/data/${id}/track`, { method: 'POST', body, responseSchema: dataRecord }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['data'] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteDataRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/data/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Record deleted')
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
  })
}
