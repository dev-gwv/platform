import { useEffect, useState } from 'react'
import { fetchFileBlob } from '@/shared/api/client'
import { HoverPopover } from '@/shared/ui/hover-popover'

/**
 * A check-in selfie, small, opening larger on hover or tap. Private: fetched
 * with the session (an <img src> cannot carry it) and only ever shown to the
 * person and the studio's managers -- the API refuses anyone else.
 */
export function SelfieThumb({ fileId, name }: { fileId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    let made: string | null = null
    fetchFileBlob(`/files/${fileId}`, ctl.signal)
      .then((b) => {
        made = URL.createObjectURL(b)
        setUrl(made)
      })
      .catch(() => setUrl(null))
    return () => {
      ctl.abort()
      if (made) URL.revokeObjectURL(made)
    }
  }, [fileId])
  if (!url) return <span className="inline-block size-8 shrink-0 rounded-md bg-muted" aria-hidden />
  return (
    <HoverPopover content={<img src={url} alt={`${name}'s check-in selfie`} className="w-56 rounded-md" />} className="w-auto p-1">
      <button type="button" className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <img src={url} alt={`${name}'s check-in selfie`} className="size-8 rounded-md object-cover" />
      </button>
    </HoverPopover>
  )
}
