import { useEffect, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { CalendarClock, MessageCircle, PlayCircle, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { AssistantPanel } from '@/features/assistant/AssistantPanel'
import { useAssistantState } from '@/features/assistant/api'
import { SupportButtons } from './HelpPanel'

/**
 * Help in the bottom-right corner, where people look for it on every other
 * app (owner, 10 Oct). One round button opens a small chat window: the
 * assistant's chat once the platform has switched it on and the server has
 * its key, and always the people behind it -- WhatsApp us, Email us, Book a
 * call. Until the assistant is on, it is the people alone. The sidebar's
 * Help and the top bar's assistant stay where they are.
 */
export function HelpBubble() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const ai = useAssistantState().data
  const aiOn = !!(ai?.enabled && ai.ready)
  const left = ai ? Math.max(0, ai.daily_limit - ai.asked_today) : 0

  // The shell outlives navigation: a link followed from inside closes it.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Above the phone's bottom bar; in the corner on a wider screen.
  const corner = 'right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:right-5 md:bottom-5'

  return (
    <div className="print:hidden">
      {open && (
        <div
          role="dialog"
          aria-label="Help"
          className={cn(
            'fixed z-30 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl',
            'max-h-[min(36rem,calc(100dvh-10rem))]',
            corner,
            'mb-16',
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Hi! How can we help?</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close help"
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {aiOn ? (
            <>
              <div className="flex min-h-[18rem] flex-1 flex-col">
                <AssistantPanel callUrl={ai?.call_url ?? null} left={left} />
              </div>
              <div className="border-t border-border p-3">
                <p className="mb-2 text-xs text-muted-foreground">Rather talk to a person?</p>
                <SupportButtons compact />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3 overflow-y-auto p-4">
              <p className="text-sm text-muted-foreground">
                We're one message away. Your studio and this page are already in the message.
              </p>
              <SupportButtons />
              {ai?.call_url && (
                <Button asChild variant="outline">
                  <a href={ai.call_url} target="_blank" rel="noreferrer">
                    <CalendarClock /> Book a call
                  </a>
                </Button>
              )}
              <Button asChild variant="ghost" className="justify-start">
                <Link to="/learn">
                  <PlayCircle /> How to use Studio AutoPilot, step by step
                </Link>
              </Button>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close help' : 'Help'}
        aria-expanded={open}
        title="Help"
        className={cn(
          'fixed z-30 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform',
          'hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          corner,
        )}
      >
        {open ? <X className="size-5" aria-hidden /> : <MessageCircle className="size-5" aria-hidden />}
      </button>
    </div>
  )
}
