import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { deliverableNote, z, type CreateDeliverableNoteRequest } from '@ipc/contracts'
import { callApi, uploadFile } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const notesKey = (deliverableId: string) => ['deliverable-notes', deliverableId] as const

/** A deliverable's timeline: notes, voice notes and stage changes, oldest first. */
export function useDeliverableNotes(deliverableId: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: notesKey(deliverableId ?? ''),
    queryFn: () => callApi(`/projects/deliverables/${deliverableId}/notes`, { responseSchema: deliverableNote.array() }),
    enabled: !!session && !!deliverableId,
    staleTime: 10_000,
  })
}

/** After a note, the card's counts and the editor's list change too. */
function useAfterNote(deliverableId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: notesKey(deliverableId) })
    void qc.invalidateQueries({ queryKey: ['projects'] })
  }
}

export function useAddDeliverableNote(deliverableId: string) {
  const after = useAfterNote(deliverableId)
  return useMutation({
    mutationFn: (input: CreateDeliverableNoteRequest) =>
      callApi(`/projects/deliverables/${deliverableId}/notes`, { method: 'POST', body: input, responseSchema: deliverableNote }),
    onSuccess: after,
  })
}

/**
 * Upload a recording, then post it as a voice note. The file is named with an
 * audio extension because the server labels uploads by extension, and a
 * `.webm` would otherwise read as video and be refused.
 */
export function useSendVoiceNote(deliverableId: string) {
  const after = useAfterNote(deliverableId)
  return useMutation({
    mutationFn: async ({ blob, seconds }: { blob: Blob; seconds: number }) => {
      const type = blob.type.split(';')[0] ?? ''
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('mpeg') ? 'mp3' : 'weba'
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      const file = new File([blob], `voice-note-${stamp}.${ext}`, { type: type || 'audio/webm' })
      const stored = await uploadFile(file)
      return callApi(`/projects/deliverables/${deliverableId}/notes`, {
        method: 'POST',
        body: { kind: 'voice', file_id: stored.id, duration_seconds: Math.round(seconds) },
        responseSchema: deliverableNote,
      })
    },
    onSuccess: () => {
      toast.success('Voice note sent')
      after()
    },
  })
}

export function useDeleteDeliverableNote(deliverableId: string) {
  const after = useAfterNote(deliverableId)
  return useMutation({
    mutationFn: (noteId: string) =>
      callApi(`/projects/deliverables/notes/${noteId}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: after,
  })
}
