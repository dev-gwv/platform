import { useEffect, useState, type ComponentProps } from 'react'
import { Headphones } from 'lucide-react'
import { useAssistantState } from '@/features/assistant/api'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { useHelp } from './api'

type ButtonProps = ComponentProps<typeof Button>

export interface CallLink {
  name: string
  url: string
}

/**
 * Where a support call is booked: each person's Google Calendar appointment
 * schedule, set on Platform -> Support calls (0290), read from the public Help
 * settings so it is there for everyone signed in (owner, 19 Oct: "accessible
 * anywhere and anytime"). With none set, the server's ONBOARDING_CALL_URL or
 * the assistant's link stands in as one.
 */
export function useCallLinks(): CallLink[] {
  const help = useHelp().data
  const ai = useAssistantState().data
  if (help?.support_calls.length) return help.support_calls
  const one = help?.support_call_url ?? ai?.call_url ?? null
  return one ? [{ name: 'Support call', url: one }] : []
}

/** The first booking page, for whatever needs one link (a toast, a check that any is set). */
export function useCallUrl(): string | null {
  return useCallLinks()[0]?.url ?? null
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

const CHOOSE_EVENT = 'support-call:choose'

/**
 * Open the chooser from somewhere that is not a button of ours (a toast's
 * action): the top bar's Support call listens for it. One link opens directly.
 */
export function openSupportCall(links: CallLink[]): void {
  if (links.length > 1) window.dispatchEvent(new Event(CHOOSE_EVENT))
  else if (links[0]) window.open(links[0].url, '_blank', 'noopener')
}

/**
 * Whom to book with, when two people take support calls (owner, 29 Oct). A
 * small box with one solid button per person; each opens that person's Google
 * Calendar booking page in a new tab, and the box closes. Google's own page is
 * never framed here.
 */
function CallChooser({ links, open, onClose }: { links: CallLink[]; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm" title="Book a support call" description="Pick a time on Google Calendar with:">
        <div className="flex flex-col gap-2">
          {links.map((l) => (
            <Button key={l.url} asChild className={cn('justify-start', SUPPORT_CALL_CLASS)}>
              <a href={l.url} target="_blank" rel="noreferrer noopener" onClick={onClose}>
                <Headphones /> {l.name}
              </a>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Book a support call: the one way to reach a person (owner, 19 Oct). With one
 * booking page it opens it in a new tab; with two it asks whom first. Drawn
 * nowhere only when no link is set.
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
  const links = useCallLinks()
  const [choosing, setChoosing] = useState(false)
  if (!links[0]) return null
  if (links.length === 1) {
    return (
      <Button asChild size={size} className={cn(SUPPORT_CALL_CLASS, className)}>
        <a href={links[0].url} target="_blank" rel="noreferrer noopener">
          <Headphones /> {label}
        </a>
      </Button>
    )
  }
  return (
    <>
      <Button type="button" size={size} className={cn(SUPPORT_CALL_CLASS, className)} onClick={() => setChoosing(true)}>
        <Headphones /> {label}
      </Button>
      <CallChooser links={links} open={choosing} onClose={() => setChoosing(false)} />
    </>
  )
}

/**
 * Support call in the top bar, on every page. The label shows from 1360px like
 * the shortcut pills; below that it rides compact as the headphones alone. Not
 * on a phone, where the bar is already full: the round help button has it.
 * It also holds the chooser that openSupportCall() asks for.
 */
export function HeaderBookCall() {
  const links = useCallLinks()
  const [choosing, setChoosing] = useState(false)
  useEffect(() => {
    const open = () => setChoosing(true)
    window.addEventListener(CHOOSE_EVENT, open)
    return () => {
      window.removeEventListener(CHOOSE_EVENT, open)
    }
  }, [])
  if (!links[0]) return null
  const look = cn(
    'hidden h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition-colors focus-visible:outline-none md:flex',
    SUPPORT_CALL_CLASS,
  )
  const inside = (
    <>
      <Headphones className="size-4" aria-hidden />
      <span className="hidden min-[1360px]:inline">Support call</span>
    </>
  )
  return (
    <>
      {links.length === 1 ? (
        <a href={links[0].url} target="_blank" rel="noreferrer noopener" aria-label="Book a support call" title="Book a support call" className={look}>
          {inside}
        </a>
      ) : (
        <button type="button" aria-label="Book a support call" title="Book a support call" className={look} onClick={() => setChoosing(true)}>
          {inside}
        </button>
      )}
      <CallChooser links={links} open={choosing} onClose={() => setChoosing(false)} />
    </>
  )
}
