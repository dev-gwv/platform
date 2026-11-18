import { useEffect, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'

/**
 * Refresh what is on screen, without reloading the page: every list, number
 * and card fetches again, and whatever you had typed stays where it is.
 * Press R anywhere outside a text box for the same.
 */
/** Fetch everything on screen again; the top bar's button and the account menu's line share it. */
export function useRefreshPage() {
  const qc = useQueryClient()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function refresh() {
    if (busy) return
    setBusy(true)
    try {
      await Promise.all([qc.invalidateQueries(), router.invalidate()])
      toast.success('Up to date', { duration: 1500 })
    } catch {
      toast.error('Could not refresh. Check your connection.')
    } finally {
      setBusy(false)
    }
  }
  return { refresh, busy }
}

export function RefreshButton({ className }: { className?: string }) {
  const { refresh, busy } = useRefreshPage()
  const fetching = useIsFetching() > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      void refresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Button variant="ghost" size="icon" aria-label="Refresh" title="Refresh (R)" className={className} onClick={() => void refresh()}>
      <RotateCw className={cn((busy || fetching) && 'animate-spin')} />
    </Button>
  )
}
