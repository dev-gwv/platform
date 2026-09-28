import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { studioWhatsappTemplate, whatsappStatus, z, type WhatsappConnectRequest, type WhatsappEmbeddedRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const K = ['whatsapp'] as const

export function useWhatsapp() {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...K, 'status'],
    queryFn: () => callApi('/whatsapp', { responseSchema: whatsappStatus }),
    enabled: !!session,
  })
}

/** The approved templates, for a sequence step that should send by itself. */
export function useWhatsappTemplates(enabled = true) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...K, 'templates'],
    queryFn: () => callApi('/whatsapp/templates', { responseSchema: z.object({ items: studioWhatsappTemplate.array() }) }),
    enabled: !!session && enabled,
    staleTime: 60_000,
  })
}

function useDone(message: string) {
  const qc = useQueryClient()
  return {
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: K })
    },
    onError: (e: Error) => toast.error(e.message || 'That did not work. Please try again.'),
  }
}

export function useConnectWhatsapp() {
  return useMutation({
    mutationFn: (v: WhatsappConnectRequest) => callApi('/whatsapp/connect', { method: 'POST', body: v, responseSchema: z.unknown() }),
    ...useDone('WhatsApp connected'),
  })
}

export function useEmbeddedWhatsapp() {
  return useMutation({
    mutationFn: (v: WhatsappEmbeddedRequest) => callApi('/whatsapp/embedded', { method: 'POST', body: v, responseSchema: z.unknown() }),
    ...useDone('WhatsApp connected'),
  })
}

export function useSyncTemplates() {
  return useMutation({
    mutationFn: () => callApi('/whatsapp/templates/sync', { method: 'POST', responseSchema: z.object({ templates: z.number() }) }),
    ...useDone('Templates updated'),
  })
}

export function useDisconnectWhatsapp() {
  return useMutation({
    mutationFn: () => callApi('/whatsapp', { method: 'DELETE', responseSchema: z.unknown() }),
    ...useDone('WhatsApp disconnected'),
  })
}
