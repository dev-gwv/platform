import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  helpContent,
  helpFaq,
  z,
  type SaveHelpContactsRequest,
  type SaveHelpFaqRequest,
  type SaveHelpVideoRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { tutorialsWith } from './tutorials'

const KEY = ['help'] as const

/** Who to reach, the answers, and the console's videos. Public: works signed out. */
export function useHelp() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/public/help', { responseSchema: helpContent }),
    staleTime: 5 * 60_000,
  })
}

/** Every tutorial, with the console's added or replaced videos. */
export function useTutorials() {
  const help = useHelp()
  return tutorialsWith(help.data?.videos ?? [])
}

function useDone(message: string) {
  const qc = useQueryClient()
  return {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
      toast.success(message)
    },
    onError: (e: Error) => toast.error(e.message),
  }
}

export function useSaveHelpContacts() {
  return useMutation({
    mutationFn: (body: SaveHelpContactsRequest) => callApi('/platform/help/contacts', { method: 'PUT', body, responseSchema: z.unknown() }),
    ...useDone('Saved. Help shows these now.'),
  })
}

export function useAddFaq() {
  return useMutation({
    mutationFn: (body: SaveHelpFaqRequest) => callApi('/platform/help/faqs', { method: 'POST', body, responseSchema: helpFaq }),
    ...useDone('Question added.'),
  })
}

export function useEditFaq() {
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SaveHelpFaqRequest> & { id: string }) =>
      callApi(`/platform/help/faqs/${id}`, { method: 'PATCH', body, responseSchema: helpFaq }),
    ...useDone('Saved.'),
  })
}

export function useDeleteFaq() {
  return useMutation({
    mutationFn: (id: string) => callApi(`/platform/help/faqs/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    ...useDone('Question removed.'),
  })
}

export function useSaveHelpVideo() {
  return useMutation({
    mutationFn: ({ key, ...body }: SaveHelpVideoRequest & { key: string }) =>
      callApi(`/platform/help/videos/${key}`, { method: 'PUT', body, responseSchema: z.unknown() }),
    ...useDone('Video saved.'),
  })
}

export function useDeleteHelpVideo() {
  return useMutation({
    mutationFn: (key: string) => callApi(`/platform/help/videos/${key}`, { method: 'DELETE', responseSchema: z.unknown() }),
    ...useDone('Back to the built-in video.'),
  })
}
