import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supportTicket, type SupportTicket, type SupportTicketStatus, type UpdateSupportTicketRequest } from '@ipc/contracts'
import { callApi, postForm } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/**
 * Support tickets (0300): one per booked call, kept by the assistant. Platform
 * admins only; the API checks again.
 */

const LIST = ['platform', 'support-tickets']
const one = (id: string) => ['platform', 'support-tickets', id]

export function useSupportTickets() {
  const { session } = useAuth()
  return useQuery({
    queryKey: LIST,
    queryFn: () => callApi('/platform/support-calls/tickets', { responseSchema: supportTicket.array() }),
    enabled: !!session?.is_platform_admin,
    refetchInterval: 60_000,
  })
}

export function useSupportTicket(id: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: one(id),
    queryFn: () => callApi(`/platform/support-calls/tickets/${id}`, { responseSchema: supportTicket }),
    enabled: !!session?.is_platform_admin,
  })
}

/** Every change to one ticket answers with the ticket, which goes straight back on screen. */
function useTicketWrite<V>(id: string, run: (v: V) => Promise<SupportTicket>, done?: (t: SupportTicket) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: (t) => {
      qc.setQueryData(one(id), t)
      void qc.invalidateQueries({ queryKey: LIST })
      done?.(t)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'That did not save.'),
  })
}

export const useUpdateTicket = (id: string) =>
  useTicketWrite(id, (body: UpdateSupportTicketRequest) =>
    callApi(`/platform/support-calls/tickets/${id}`, { method: 'PATCH', body, responseSchema: supportTicket }),
  )

const readDone = (t: SupportTicket) =>
  toast.success(t.status === 'solved' ? 'Ticket filled in and marked solved.' : 'Ticket filled in from your note.')

export const useTicketNote = (id: string) =>
  useTicketWrite(id, (text: string) => callApi(`/platform/support-calls/tickets/${id}/note`, { method: 'POST', body: { text }, responseSchema: supportTicket }), readDone)

export const useTicketVoice = (id: string) =>
  useTicketWrite(
    id,
    async (blob: Blob) => {
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      const json = await postForm(`/platform/support-calls/tickets/${id}/voice`, () => {
        const form = new FormData()
        form.append('audio', blob, `note.${ext}`)
        return form
      })
      return supportTicket.parse(json)
    },
    readDone,
  )

export const useTicketBrief = (id: string) =>
  useTicketWrite(id, () => callApi(`/platform/support-calls/tickets/${id}/brief`, { method: 'POST', responseSchema: supportTicket }), () =>
    toast.success('Brief written.'),
  )

/** Neutral by default, amber for what waits on you, green once solved. */
export const STATUS_TONE: Record<SupportTicketStatus, 'neutral' | 'success' | 'warning' | 'info'> = {
  booked: 'info',
  open: 'warning',
  waiting_us: 'warning',
  waiting_them: 'neutral',
  solved: 'success',
  cancelled: 'neutral',
}

/** India's date today, for "late". */
export const indiaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

/** "Thu 12 Nov, 3:00 pm". */
export function callWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso))
    .replace(/\s?([ap])\.?m\.?/i, ' $1m')
}

/** "Due tomorrow" / "2 days late". */
export function dueWords(due: string | null): string | null {
  if (!due) return null
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${indiaToday()}T00:00:00Z`)) / 86_400_000)
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days > 1) return `Due in ${days} days`
  return days === -1 ? '1 day late' : `${-days} days late`
}
