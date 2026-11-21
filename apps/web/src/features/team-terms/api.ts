import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  sendTeamTermsResponse,
  teamTermsSend,
  teamTermsTemplate,
  z,
  type SaveTeamTermsTemplateRequest,
  type SendTeamTermsRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const templates = teamTermsTemplate.array()
const sends = teamTermsSend.array()
const created = z.object({ id: z.string().uuid() })
const anySchema = z.any()

export function useTeamTermsTemplates(archived = false) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['team-terms', 'templates', archived],
    queryFn: () =>
      callApi(`/team-terms/templates${archived ? '?archived=1' : ''}`, {
        responseSchema: templates,
      }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 60_000,
  })
}

/** What has gone out for one shoot: who has it, who has read it, who signed. */
export function useTeamTermsSends(shootId: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['team-terms', 'sends', shootId],
    queryFn: () => callApi(`/team-terms/sends?shoot_id=${shootId}`, { responseSchema: sends }),
    enabled: !!session && !!shootId,
    staleTime: 15_000,
  })
}

/**
 * One shoot's sends, read from the whole project's: the project's Shoots tab
 * draws a card per shoot, and each asking on its own was a request per day of
 * the wedding. Every card shares this one query (the same key), and picks its
 * shoot out of it.
 */
export function useProjectTeamTermsSends(projectId: string | null, shootId: string) {
  const { session } = useAuth()
  const pick = useCallback((rows: TeamTermsSendRow[]) => rows.filter((r) => r.shoot_id === shootId), [shootId])
  return useQuery({
    queryKey: ['team-terms', 'sends', 'project', projectId],
    queryFn: () => callApi(`/team-terms/sends?project_id=${projectId}`, { responseSchema: sends }),
    enabled: !!session && !!projectId,
    staleTime: 15_000,
    select: pick,
  })
}

type TeamTermsSendRow = z.infer<typeof teamTermsSend>

function useTermsMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  message: string,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['team-terms'] })
    },
  })
}

export function useSaveTeamTermsTemplate() {
  return useTermsMutation(
    ({ id, body }: { id?: string; body: SaveTeamTermsTemplateRequest }) =>
      callApi(id ? `/team-terms/templates/${id}` : '/team-terms/templates', {
        method: id ? 'PATCH' : 'POST',
        body,
        responseSchema: id ? anySchema : created,
      }),
    'Terms saved',
  )
}

/**
 * Archived, not deleted: a send points at the template it went out under, and
 * a studio may need to show what those words were a year later.
 */
export function useArchiveTeamTermsTemplate() {
  return useTermsMutation(
    ({ id, restore }: { id: string; restore?: boolean }) =>
      callApi(`/team-terms/templates/${id}/archive${restore ? '?restore=1' : ''}`, {
        method: 'POST',
        responseSchema: anySchema,
      }),
    'Updated',
  )
}

/**
 * Permanent delete with a server-side usage guard: used templates are
 * refused with 409 (archive instead). The button stays disabled with a hint
 * once send_count > 0, so the 409 is a backstop, not the UX.
 */
export function useDeleteTeamTermsTemplate() {
  return useTermsMutation(
    (id: string) => callApi(`/team-terms/templates/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Terms deleted',
  )
}

export function useSendTeamTerms() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SendTeamTermsRequest) =>
      callApi('/team-terms/sends', {
        method: 'POST',
        body: input,
        responseSchema: sendTeamTermsResponse,
      }),
    onSuccess: (result) => {
      // The link matters more than the toast when no email went: it is the
      // only copy of it the sender will ever see.
      toast.success(result.email === 'sent' ? 'Terms emailed' : 'Terms ready — copy the link')
      void qc.invalidateQueries({ queryKey: ['team-terms'] })
    },
  })
}

export function useRevokeTeamTerms() {
  return useTermsMutation(
    (id: string) =>
      callApi(`/team-terms/sends/${id}/revoke`, { method: 'POST', responseSchema: anySchema }),
    'Withdrawn',
  )
}
