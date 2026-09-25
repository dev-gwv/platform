import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { productionBoard, z, type BoardDeliverable, type BulkDeliverableRequest, type ProductionBoard } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

/**
 * Under 'projects' so every deliverable change anywhere in the app -- the
 * project page, My Work, the drawer -- refreshes the board too.
 */
export const BOARD_KEY = ['projects', 'board'] as const

export function useProductionBoard() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: BOARD_KEY,
    queryFn: () => callApi('/projects/board', { responseSchema: productionBoard }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Change one card on the board before the server answers, so a drag lands
 * where it was dropped; put it back if the server says no.
 */
async function patchCard(qc: QueryClient, id: string, patch: Partial<BoardDeliverable>) {
  await qc.cancelQueries({ queryKey: BOARD_KEY })
  const before = qc.getQueryData<ProductionBoard>(BOARD_KEY)
  if (before) {
    qc.setQueryData<ProductionBoard>(BOARD_KEY, {
      ...before,
      items: before.items.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })
  }
  return { before }
}

function settle(qc: QueryClient, ids: readonly string[]) {
  void qc.invalidateQueries({ queryKey: ['projects'] })
  for (const id of ids) void qc.invalidateQueries({ queryKey: ['deliverable-notes', id] })
}

const none = z.any()

/** Drag to a stage lane: the same move as the card's own button. */
export function useBoardMove() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; status: string; custom_status_code: string | null; delivery_link?: string | null }) =>
      callApi(`/projects/deliverables/${v.id}/stage`, {
        method: 'POST',
        body: {
          status: v.status,
          custom_status_code: v.custom_status_code,
          ...(v.delivery_link !== undefined ? { delivery_link: v.delivery_link } : {}),
        },
        responseSchema: none,
      }),
    onMutate: (v) => patchCard(qc, v.id, { status: v.status, custom_status_code: v.custom_status_code }),
    onError: (e: Error, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(BOARD_KEY, ctx.before)
      toast.error(e.message)
    },
    onSettled: (_d, _e, v) => settle(qc, [v.id]),
  })
}

/** Drag to a person: hand the work to them (or to nobody). */
export function useBoardReassign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; projectId: string; assigneeId: string | null; assigneeName: string | null }) =>
      callApi(`/projects/${v.projectId}/deliverables/${v.id}`, {
        method: 'PATCH',
        body: { assignee_id: v.assigneeId },
        responseSchema: none,
      }),
    onMutate: (v) => patchCard(qc, v.id, { assignee_id: v.assigneeId, assignee_name: v.assigneeName }),
    onSuccess: (_d, v) => toast.success(v.assigneeName ? `Given to ${v.assigneeName}` : 'Editor removed'),
    onError: (e: Error, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(BOARD_KEY, ctx.before)
      toast.error(e.message)
    },
    onSettled: (_d, _e, v) => settle(qc, [v.id]),
  })
}

/** One change to every selected card. */
export function useBulkDeliverables() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BulkDeliverableRequest) =>
      callApi('/projects/deliverables/bulk', { method: 'POST', body, responseSchema: z.object({ updated: z.number() }) }),
    onSuccess: (r) => toast.success(`${r.updated} deliverable${r.updated === 1 ? '' : 's'} updated`),
    onError: (e: Error) => toast.error(e.message),
    onSettled: (_d, _e, v) => settle(qc, v.ids),
  })
}
