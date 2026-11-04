import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ExternalLink, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { GalleryGuide } from '@/features/gallery/GalleryGuide'
import { galleryAppLink } from '@/features/gallery/api'

export function GalleryAppPage() {
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <GalleryApp />
    </AuthedPage>
  )
}

/** Where the person was in Frameline, so the page reopens there (this tab only). */
const LAST_PATH = 'sa.gallery-app.path'
const appPath = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !/[\\\s]/.test(p) && p.length <= 200
function lastPath() {
  try {
    const p = sessionStorage.getItem(LAST_PATH)
    return appPath(p) ? p : undefined
  } catch {
    return undefined
  }
}

type FromFrameline = { source: 'frameline'; type: 'ready' | 'route' | 'open' | 'signed-out'; path?: string }

/**
 * Frameline's studio app (the gallery add-on) inside the dashboard, signed in
 * by a fresh single-use link each time it loads.
 *
 * Frameline keeps the frame's sign-in in its own browser storage, so third-party
 * cookie blocking doesn't sign it out. Google won't show its pages in a frame,
 * so Frameline asks us (`open`) to open its Google Drive steps in a signed-in
 * tab of their own; `signed-out` asks for a fresh link; `route` remembers the
 * page. Messages are taken only from our own frame.
 */
function GalleryApp() {
  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [height, setHeight] = useState(640)
  const reloads = useRef<number[]>([])

  const load = useCallback(async (path?: string) => {
    setError(null)
    try {
      setSrc(await galleryAppLink(path))
    } catch (e) {
      setError(e as Error)
    }
  }, [])

  useEffect(() => {
    void load(lastPath())
  }, [load])

  // The frame fills the window below the header; Frameline scrolls inside it.
  useLayoutEffect(() => {
    const fit = () => {
      const top = box.current?.getBoundingClientRect().top ?? 0
      setHeight(Math.max(480, window.innerHeight - top - 16))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [src, error])

  /** A Frameline page in its own tab, signed in. Opened at the click, before the link is asked for. */
  const openTab = useCallback(async (path?: string) => {
    const w = window.open('', '_blank')
    try {
      const url = await galleryAppLink(path)
      if (w) {
        w.opener = null
        w.location.href = url
      } else {
        window.location.href = url
      }
    } catch (e) {
      w?.close()
      toast.error((e as Error).message)
    }
  }, [])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const d = e.data as FromFrameline | null
      if (d?.source !== 'frameline') return
      if (d.type === 'ready') frame.current.contentWindow?.postMessage({ source: 'studioautopilot', type: 'hello' }, e.origin)
      else if (d.type === 'route' && appPath(d.path)) {
        try {
          sessionStorage.setItem(LAST_PATH, d.path)
        } catch {
          /* private window: reopen at home */
        }
      } else if (d.type === 'open' && appPath(d.path)) void openTab(d.path)
      else if (d.type === 'signed-out') {
        // At most three fresh links a minute, so a frame that keeps losing its session can't loop.
        const now = Date.now()
        reloads.current = reloads.current.filter((t) => now - t < 60_000)
        if (reloads.current.length >= 3) return
        reloads.current.push(now)
        void load(lastPath())
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [load, openTab])

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Gallery app"
        description="Frameline, the gallery add-on, right here: events, uploads, guests and sharing."
        actions={
          <>
            <GalleryGuide />
            <Button variant="outline" size="sm" onClick={() => void load(lastPath())} aria-label="Reload the gallery app">
              <RotateCw className="size-4" aria-hidden /> Reload
            </Button>
            <Button variant="outline" size="sm" onClick={() => void openTab(lastPath())}>
              <ExternalLink className="size-4" aria-hidden /> Open in new tab
            </Button>
          </>
        }
      />
      <div ref={box}>
        {error ? (
          <ErrorState error={error} onRetry={() => void load(lastPath())} />
        ) : src ? (
          <iframe
            ref={frame}
            key={src}
            src={src}
            title="Frameline gallery app"
            referrerPolicy="no-referrer"
            allow="clipboard-write; fullscreen"
            className="w-full rounded-lg border bg-background"
            style={{ height }}
          />
        ) : (
          <div style={{ height }}>
            <Skeleton className="size-full rounded-lg" />
          </div>
        )}
      </div>
    </div>
  )
}
