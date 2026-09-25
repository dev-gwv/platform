import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { workReminderSettings, workSubmission, z, type ReviewWorkRequest, type UpdateWorkReminderSettingsRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const noContent = z.unknown()
const list = workSubmission.array()
const anySchema = z.any()

/** When a team member is nudged to submit pending work before a task's due date. */
export function useWorkReminderSettings() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['work', 'reminder-settings'],
    queryFn: () => callApi('/work/reminder-settings', { responseSchema: workReminderSettings }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useUpdateWorkReminderSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateWorkReminderSettingsRequest) =>
      callApi('/work/reminder-settings', { method: 'PATCH', body: input, responseSchema: noContent }),
    onSuccess: () => {
      toast.success('Reminder settings saved')
      void qc.invalidateQueries({ queryKey: ['work', 'reminder-settings'] })
    },
  })
}

/** One project's own submitted work — its detail page's Completed Work tab. */
export function useProjectWorkSubmissions(projectId: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['work', 'submissions', 'project', projectId],
    queryFn: () => callApi(`/work/submissions?project_id=${projectId}`, { responseSchema: list }),
    enabled: !!session && !!projectId,
    staleTime: 15_000,
  })
}

/** My own submissions on one project -- My Work's project page. */
export function useMyProjectWorkSubmissions(projectId: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['work', 'submissions', 'mine', projectId],
    queryFn: () => callApi(`/work/submissions?mine=1&project_id=${projectId}`, { responseSchema: list }),
    enabled: !!session && !!projectId,
    staleTime: 15_000,
  })
}

export function useReviewWork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & ReviewWorkRequest) =>
      callApi(`/work/submissions/${id}/review`, { method: 'POST', body, responseSchema: anySchema }),
    onSuccess: (_data, { approve }) => {
      toast.success(approve ? 'Work approved' : 'Work sent back for changes')
      void qc.invalidateQueries({ queryKey: ['work', 'submissions'] })
      // Team Work Preview keeps its own copy of one person's submissions.
      void qc.invalidateQueries({ queryKey: ['team-work-preview'] })
      // Approving or sending back moves the deliverable it was for (0166).
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['deliverable-notes'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/**
 * Send the work-submission nudges now instead of waiting for the hourly tick.
 *
 * Owner-only on the server. Useful straight after changing the day offsets —
 * otherwise the only way to know the settings do anything is to wait an hour.
 */
export function useRunWorkReminders() {
  return useMutation({
    mutationFn: () =>
      callApi('/work/reminders/run', {
        method: 'POST',
        responseSchema: z.object({ ok: z.boolean(), summary: z.record(z.unknown()).default({}) }),
      }),
    onSuccess: () => toast.success('Reminders sent'),
    onError: (e: Error) => toast.error(e.message),
  })
}

/**
 * Mint a client-facing delivery link for a finished submission.
 *
 * The send dialog used to share `submission_link` -- the raw internal URL the
 * editor pasted, a Drive folder as often as not. That has no expiry, cannot
 * be revoked, and leaves no record of what was sent to whom. All three of
 * those exist server-side (`deliver_work_to_client`, the revoke endpoint,
 * `team_work_client_deliveries`) and nothing had ever called them.
 */
export function useDeliverWork() {
  return useMutation({
    mutationFn: ({ id, channel }: { id: string; channel: string }) =>
      callApi(`/work/submissions/${id}/deliver`, {
        method: 'POST',
        body: { channel },
        responseSchema: z.object({ token: z.string(), link: z.string() }),
      }),
    onError: (e: Error) => toast.error(e.message),
  })
}

/**
 * Record that a submission went to the client, and on which channel.
 *
 * `/work/submissions/:id/client-sent` has existed since 0104 and nothing
 * called it, while the My Work list has always rendered "Sent to client via
 * …" from the column it sets — so that line could never appear, whatever
 * anyone did.
 */
export function useMarkClientSent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, channel }: { id: string; channel: string }) =>
      callApi(`/work/submissions/${id}/client-sent`, {
        method: 'POST',
        body: { channel },
        responseSchema: z.object({ ok: z.boolean() }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['work', 'submissions'] })
    },
    // Recording the send must never be what stops someone sending: the
    // WhatsApp or mail window has already opened by this point.
    onError: () => {},
  })
}

/**
 * Pull a client delivery link back.
 *
 * `/work/submissions/:id/revoke-delivery` has existed since 0010 and nothing
 * called it, so "a client link you can revoke later" was a promise the app
 * had no way to keep. Revoking expires the token, marks the delivery row and
 * makes the public page refuse it.
 */
export function useRevokeDelivery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/work/submissions/${id}/revoke-delivery`, {
        method: 'POST',
        responseSchema: z.object({ ok: z.boolean() }),
      }),
    onSuccess: () => {
      toast.success('Link revoked. The client can no longer open it.')
      void qc.invalidateQueries({ queryKey: ['work', 'submissions'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
