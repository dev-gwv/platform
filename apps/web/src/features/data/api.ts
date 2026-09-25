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
  dataBoard,
  bulkDataResult,
  dataPerson,
  type BulkDataRequest,
  type HandoverRequest,
  type UpsertDataPersonRequest,
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
    mutationFn: (id: string) =>
      callApi(`/data/locations/${id}`, { method: 'DELETE', responseSchema: z.object({ archived: z.boolean() }) }),
    onSuccess: (r) => {
      // One that records point at is archived instead, so they keep saying where they went.
      toast.success(r.archived ? 'Location archived -- records still point at it' : 'Location removed')
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

/** Everything the board shows: a row per booked person whose shoot day has come. */
export const DATA_BOARD_KEY = ['data', 'board'] as const

export function useDataBoard(projectId?: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: projectId ? [...DATA_BOARD_KEY, projectId] : DATA_BOARD_KEY,
    queryFn: () => callApi(projectId ? `/data/board?project_id=${projectId}` : '/data/board', { responseSchema: dataBoard }),
    enabled: !!session && access.hasAction('projects', 'edit'),
    staleTime: 15_000,
  })
}

export function useBulkData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BulkDataRequest) => callApi('/data/bulk', { method: 'POST', body, responseSchema: bulkDataResult }),
    onSuccess: (r) => {
      const done = r.updated === 1 ? '1 updated' : `${r.updated} updated`
      if (r.skipped > 0) toast.warning(`${done}. ${r.skipped} skipped -- not at that step yet.`)
      else toast.success(done)
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Crew: their own records (matched to My Shoots by booking). */
export function useMyData() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['data', 'mine'],
    queryFn: () => callApi('/data/mine', { responseSchema: list }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

/** Crew hand their cards over for one of their own bookings. */
export function useHandover() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slotId, ...body }: HandoverRequest & { slotId: string }) =>
      callApi(`/data/mine/${slotId}`, { method: 'POST', body, responseSchema: dataRecord }),
    onSuccess: () => {
      toast.success('Handed over. The studio can see it now.')
      void qc.invalidateQueries({ queryKey: ['data'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Outside helpers who copy data (not on the team). */
export function useDataPeople() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['data', 'people'],
    queryFn: () => callApi('/data/people', { responseSchema: dataPerson.array() }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 60_000,
  })
}

export function useCreateDataPerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpsertDataPersonRequest) => callApi('/data/people', { method: 'POST', body, responseSchema: dataPerson }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['data', 'people'] }),
    onError: (e: Error) => toast.error(e.message),
  })
}
