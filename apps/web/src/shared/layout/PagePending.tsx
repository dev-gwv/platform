import { useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/shared/ui/button'

/** How long a page may take to arrive before we offer a reload. */
export const SLOW_PAGE_MS = 12_000

/**
 * What shows while a page's own file is still on its way. It used to be
 * nothing: when the host stalled on one file during a deploy (20 Oct, Leads
 * hung for minutes) the screen stayed white with no way on. A spinner first,
 * then, if it is slow, a plain line and Reload.
 */
export function PagePending() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_PAGE_MS)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      {slow && (
        <>
          <p className="text-sm text-muted-foreground">This page is taking longer than usual · थोड़ा समय लग रहा है</p>
          <Button onClick={() => window.location.reload()}>
            <RotateCcw /> Reload
          </Button>
        </>
      )}
    </div>
  )
}
