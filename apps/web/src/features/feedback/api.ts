import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { featureRequest, z, type FeatureRequestStatus, type UpdateFeatureRequest } from '@ipc/contracts'
import { callApi, uploadFile } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const audioExt = (type: string) => (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('mpeg') ? 'mp3' : 'weba')

/**
 * Send a suggestion: the recording and screenshot go up first as the sender's
 * own private files, then the suggestion pointing at them.
 */
export function useSendFeatureRequest() {
  return useMutation({
    mutationFn: async (input: { body: string; voice: { blob: Blob; seconds: number } | null; screenshot: Blob | null }) => {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      let voice_file_id: string | undefined
      let screenshot_file_id: string | undefined
      if (input.voice) {
        const type = input.voice.blob.type.split(';')[0] || 'audio/webm'
        const stored = await uploadFile(new File([input.voice.blob], `suggestion-${stamp}.${audioExt(type)}`, { type }))
        voice_file_id = stored.id
      }
      if (input.screenshot) {
        const type = input.screenshot.type || 'image/png'
        const ext = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png'
        const stored = await uploadFile(new File([input.screenshot], `screenshot-${stamp}.${ext}`, { type }))
        screenshot_file_id = stored.id
      }
      return callApi('/feedback/features', {
        method: 'POST',
        body: {
          ...(input.body.trim() ? { body: input.body.trim() } : {}),
          ...(voice_file_id ? { voice_file_id, voice_seconds: Math.round(input.voice?.seconds ?? 0) } : {}),
          ...(screenshot_file_id ? { screenshot_file_id } : {}),
          page_url: window.location.pathname + window.location.search,
        },
        responseSchema: z.object({ id: z.string() }),
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

const KEY = ['platform', 'feedback'] as const

export function usePlatformFeedback(status: FeatureRequestStatus | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...KEY, status ?? 'all'],
    queryFn: () => callApi(`/platform/feedback${status ? `?status=${status}` : ''}`, { responseSchema: featureRequest.array() }),
    enabled: !!session?.is_platform_admin,
    staleTime: 30_000,
  })
}

export function useUpdateFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateFeatureRequest) =>
      callApi(`/platform/feedback/${id}`, { method: 'PATCH', body, responseSchema: z.unknown() }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e: Error) => toast.error(e.message),
  })
}
