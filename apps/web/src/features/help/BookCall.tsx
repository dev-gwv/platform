import { useEffect, useSyncExternalStore, type ComponentProps, type MouseEvent } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { ExternalLink, Headphones } from 'lucide-react'
import { useAssistantState } from '@/features/assistant/api'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { useHelp } from './api'
import { BOOKING_APP_ORIGINS, embedUrlFor } from './support-call'

type ButtonProps = ComponentProps<typeof Button>

/**
 * The call link: the Help console's `support_call_url`, else the server's
 * ONBOARDING_CALL_URL. Read from the public Help settings, so it is there for
 * everyone signed in (owner, 19 Oct: "accessible anywhere and anytime"), with
 * the assistant's copy as a second source.
 */
export function useCallUrl(): string | null {
  const help = useHelp().data
  const ai = useAssistantState().data
  return help?.support_call_url ?? ai?.call_url ?? null
}

/**
 * The support call's look, the same everywhere it is drawn: a solid teal fill
 * with the headphones, so it stands out from the buttons around it (owner,
 * 21 Oct: "make it a bit stand out across the site"). The soft teal is the
 * text because it is light on the dark teal and dark on the light one, so it
 * reads in both themes.
 */
export const SUPPORT_CALL_CLASS =
  'border border-tone-teal bg-tone-teal text-tone-teal-soft shadow-sm hover:bg-tone-teal/90 focus-visible:ring-2 focus-visible:ring-tone-teal/40'

// ── the popup ────────────────────────────────────────────────────────────
// One calendar for the whole app, opened from any button: the top bar, the
// help bubble, the assistant, a "Stuck?" toast.

let openEmbed: { embed: string; link: string } | null = null
const listeners = new Set<() => void>()
const setOpen = (next: typeof openEmbed) => {
  openEmbed = next
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * How to open the support call from here. With "Open the calendar inside the
 * app" on (Platform → Help, 0279) and a booking-app link, the calendar opens
 * over the page with the person's name, email and studio filled in; otherwise
 * the link opens in a new tab, as it always has.
 */
export function useSupportCall(): { url: string | null; open: (event?: MouseEvent) => void } {
  const url = useCallUrl()
  const inApp = useHelp().data?.support_call_in_app ?? false
  const { session } = useAuth()
  const page = useRouterState({ select: (s) => s.location.pathname })
  const embed = inApp
    ? embedUrlFor(url, {
        name: session?.display_name,
        // Team logins may carry a made-up email (it is only a username), so a
        // booking confirmation is sent to an owner's confirmed one alone.
        email: session?.is_owner && session.email_verified ? session.email : null,
        studio: session?.studios.find((s) => s.company_id === session.company_id)?.company_name,
        page,
        origin: window.location.origin,
      })
    : null
  return {
    url,
    open: (event) => {
      if (!url) return
      if (embed) {
        event?.preventDefault()
        setOpen({ embed, link: url })
      } else if (!event) {
        window.open(url, '_blank', 'noopener')
      }
      // A click on a link with no in-app calendar follows its own href.
    },
  }
}

/** The popup itself, mounted once in the app shell. */
export function SupportCallHost() {
  const current = useSyncExternalStore(subscribe, () => openEmbed)
  useEffect(() => {
    if (!current) return
    // The calendar's own Close, and a "go here after booking" page, which
    // opens beside the app rather than taking the app's place.
    const onMessage = (event: MessageEvent) => {
      if (!(BOOKING_APP_ORIGINS as readonly string[]).includes(event.origin)) return
      const message = (event.data ?? {}) as { type?: string; url?: unknown }
      if (message.type === 'buildour:close') setOpen(null)
      else if (message.type === 'buildour:redirect' && /^https:\/\//.test(String(message.url)))
        window.open(String(message.url), '_blank', 'noopener')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [current])

  return (
    <Dialog open={!!current} onOpenChange={(o) => !o && setOpen(null)}>
      {current && (
        <DialogContent
          title="Book a support call"
          className="flex h-[min(820px,90dvh)] max-w-4xl flex-col overflow-hidden p-0 [&>div:first-child]:mb-0 [&>div:first-child]:border-b [&>div:first-child]:border-border [&>div:first-child]:px-4 [&>div:first-child]:py-3"
        >
          <iframe src={current.embed} title="Book a support call" className="min-h-0 w-full flex-1 border-0 bg-white" />
          <a
            href={current.link}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center justify-center gap-1.5 border-t border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3.5" aria-hidden /> Calendar not showing? Open it in a new tab
          </a>
        </DialogContent>
      )}
    </Dialog>
  )
}

// ── the buttons ──────────────────────────────────────────────────────────

/**
 * Book a support call: the one way to reach a person (owner, 19 Oct). It
 * opens the calendar over the app or in a new tab (see useSupportCall); the
 * booking app takes the booking from there. Drawn nowhere only when no link
 * is set at all.
 */
export function BookCallButton({
  label = 'Book a support call',
  className,
  size,
}: {
  label?: string
  className?: string
  size?: ButtonProps['size']
}) {
  const call = useSupportCall()
  if (!call.url) return null
  return (
    <Button asChild size={size} className={cn(SUPPORT_CALL_CLASS, className)}>
      <a href={call.url} target="_blank" rel="noreferrer noopener" onClick={call.open}>
        <Headphones /> {label}
      </a>
    </Button>
  )
}

/**
 * Support call in the top bar, on every page. The label shows from 1360px like
 * the shortcut pills; below that it rides compact as the headphones alone. Not
 * on a phone, where the bar is already full: the round help button has it.
 */
export function HeaderBookCall() {
  const call = useSupportCall()
  if (!call.url) return null
  return (
    <a
      href={call.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={call.open}
      aria-label="Book a support call"
      title="Book a support call"
      className={cn(
        'hidden h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition-colors focus-visible:outline-none md:flex',
        SUPPORT_CALL_CLASS,
      )}
    >
      <Headphones className="size-4" aria-hidden />
      <span className="hidden min-[1360px]:inline">Support call</span>
    </a>
  )
}
