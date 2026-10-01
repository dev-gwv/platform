import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  z,
  quotationTermsPreset,
  type QuotationTermsPreset,
  type SaveQuotationTermsPresetRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const KEY = ['projects', 'quotation-terms'] as const
/** Where the presets lived before they belonged to the studio (0227). */
export const LOCAL_PRESET_KEY = 'ipc.quotation.presets'

/** The studio's quotation terms presets; the default comes first. */
export function useTermsPresets(enabled = true) {
  const { session } = useAuth()
  return useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/projects/quotation-terms', { responseSchema: quotationTermsPreset.array() }),
    enabled: !!session && enabled,
    staleTime: 60_000,
  })
}

/** The terms a project shows when it has none of its own. */
export function defaultTermsBody(presets: readonly QuotationTermsPreset[] | undefined): string | null {
  return presets?.find((p) => p.is_default)?.body ?? null
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: KEY })
}

export function useSaveTermsPreset() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (body: SaveQuotationTermsPresetRequest) =>
      callApi('/projects/quotation-terms', { method: 'POST', body, responseSchema: quotationTermsPreset }),
    onSuccess: () => void done(),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save the preset.'),
  })
}

export function useUpdateTermsPreset() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SaveQuotationTermsPresetRequest> }) =>
      callApi(`/projects/quotation-terms/${id}`, { method: 'PATCH', body: patch, responseSchema: quotationTermsPreset }),
    onSuccess: () => void done(),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change the preset.'),
  })
}

export function useDeleteTermsPreset() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => callApi(`/projects/quotation-terms/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: () => void done(),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete the preset.'),
  })
}

interface LocalPreset {
  title?: unknown
  body?: unknown
}

/** Presets saved in this browser before 0227, worth keeping. */
export function readLocalPresets(raw: string | null): Array<{ title: string; body: string }> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return (parsed as LocalPreset[])
      .map((p) => ({
        title: typeof p.title === 'string' ? p.title.trim().slice(0, 80) : '',
        body: typeof p.body === 'string' ? p.body.trim().slice(0, 10000) : '',
      }))
      .filter((p) => p.title && p.body)
  } catch {
    return []
  }
}

/**
 * Once, for someone who can keep the list: presets this browser saved before
 * they were shared move to the studio (skipping a name the studio already
 * has), and the browser's copy goes.
 */
export function useMoveLocalPresets(presets: readonly QuotationTermsPreset[] | undefined, canEdit: boolean) {
  const done = useInvalidate()
  const ran = useRef(false)
  useEffect(() => {
    if (!canEdit || !presets || ran.current) return
    let raw: string | null = null
    try {
      raw = localStorage.getItem(LOCAL_PRESET_KEY)
    } catch {
      return
    }
    const local = readLocalPresets(raw)
    ran.current = true
    if (raw === null) return
    const have = new Set(presets.map((p) => p.title.trim().toLowerCase()))
    const fresh = local.filter((p, i, all) => !have.has(p.title.toLowerCase()) && all.findIndex((q) => q.title.toLowerCase() === p.title.toLowerCase()) === i)
    void (async () => {
      let moved = 0
      for (const p of fresh) {
        try {
          await callApi('/projects/quotation-terms', { method: 'POST', body: p, responseSchema: quotationTermsPreset })
          moved++
        } catch {
          // A name clash or a refusal: the rest still move.
        }
      }
      try {
        localStorage.removeItem(LOCAL_PRESET_KEY)
      } catch {
        // Blocked storage: it is read once per load, and names already moved are skipped.
      }
      if (moved > 0) {
        toast.success(`${moved} saved ${moved === 1 ? 'preset is' : 'presets are'} now shared with your studio`)
        void done()
      }
    })()
  }, [presets, canEdit, done])
}
