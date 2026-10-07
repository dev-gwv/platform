import { useEffect, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { Sheet, SheetContent } from '@/shared/ui/sheet'
import { cn } from '@/shared/ui/cn'
import { AssistantPanel } from './AssistantPanel'
import { useAssistantState } from './api'

/**
 * The assistant in the top bar, beside Alerts.
 *
 * Its own button rather than a tab inside Help, because asking a question is a
 * different act from browsing the tutorials: one is "I am stuck now", the other
 * is "show me what this does". Help keeps its job in the sidebar.
 *
 * Nothing is drawn at all until the platform has switched the assistant on, so
 * a studio never meets a button that answers "not set up yet".
 */
export function AssistantButton() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { data } = useAssistantState()

  // The shell outlives navigation, so nothing else would close the panel when
  // the page changes underneath it.
  useEffect(() => setOpen(false), [pathname])

  // Off, still loading, or unreachable: no button. A button that cannot work is
  // worse than no button, and `ready` is false when the server has no key.
  if (!data?.enabled || !data.ready) return null

  const left = Math.max(0, data.daily_limit - data.asked_today)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask for help"
        title="Ask for help"
        className={cn(
          'relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors',
          'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'bg-accent text-accent-foreground',
        )}
      >
        <Sparkles className="size-4" aria-hidden />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          title="Ask for help"
          description="Answers from the app’s own help content."
          className="sm:max-w-md"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 pr-12">
            <Sparkles className="size-4 text-tone-violet" aria-hidden />
            <h2 className="text-sm font-semibold">Ask for help</h2>
          </div>
          {/* Mounted only while open, so a fresh question starts a fresh thread. */}
          <AssistantPanel callUrl={data.call_url} left={left} />
        </SheetContent>
      </Sheet>
    </>
  )
}
