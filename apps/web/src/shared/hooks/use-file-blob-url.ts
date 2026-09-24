import { useEffect, useState } from 'react'
import { fetchFileBlob } from '@/shared/api/client'
import { MOCK_ENABLED } from '@/shared/dev/mock'

/**
 * A private file as a URL the browser can play or show.
 *
 * Stored files need the bearer token, which <audio src> cannot send, so the
 * bytes are fetched with it and handed over as an object URL -- revoked when
 * the component goes, so a long timeline does not pile up blobs. Loads only
 * when `enabled`, so a list of voice notes fetches each one on first play.
 */
export function useFileBlobUrl(fileId: string | null | undefined, enabled = true) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!fileId || !enabled) return
    // The preview has no file store; a short silence stands in.
    if (MOCK_ENABLED) {
      setUrl(SILENT_WAV)
      return
    }
    const ctrl = new AbortController()
    let made: string | null = null
    fetchFileBlob(`/files/${fileId}`, ctrl.signal)
      .then((blob) => {
        made = URL.createObjectURL(blob)
        setUrl(made)
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load it.')
      })
    return () => {
      ctrl.abort()
      if (made) URL.revokeObjectURL(made)
    }
  }, [fileId, enabled])

  return { url, error }
}

/** One second of silence, for the mock preview. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
