import { Headphones } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useAssistantState } from '@/features/assistant/api'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useHelp } from './api'

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

/**
 * Book a support call: the one way to reach a person (owner, 19 Oct). It
 * opens our booking page in a new tab; that app takes the booking from there.
 * Drawn nowhere only when no link is set at all.
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
  const url = useCallUrl()
  if (!url) return null
  return (
    <Button asChild size={size} className={cn(SUPPORT_CALL_CLASS, className)}>
      <a href={url} target="_blank" rel="noreferrer noopener">
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
  const url = useCallUrl()
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
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
