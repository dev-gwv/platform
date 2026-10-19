import type { ComponentProps } from 'react'
import { CalendarClock } from 'lucide-react'
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
 * Book a call: the one way to reach a person (owner, 19 Oct). It opens our
 * booking page in a new tab; that app takes the booking from there. Drawn
 * nowhere only when no link is set at all.
 */
export function BookCallButton({
  label = 'Book a call',
  className,
  size,
  variant = 'outline',
}: {
  label?: string
  className?: string
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
}) {
  const url = useCallUrl()
  if (!url) return null
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <a href={url} target="_blank" rel="noreferrer noopener">
        <CalendarClock /> {label}
      </a>
    </Button>
  )
}

/**
 * Book a call in the top bar, on every page. The label shows from 1360px like
 * the shortcut pills; below that it rides compact as the icon alone. Not on a
 * phone, where the bar is already full: the round help button has it there.
 */
export function HeaderBookCall() {
  const url = useCallUrl()
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Book a call with us"
      title="Book a call with us"
      className={cn(
        'hidden h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-tone-teal/40 bg-tone-teal-soft px-2.5 text-sm font-medium text-tone-teal transition-colors',
        'md:flex hover:border-tone-teal hover:bg-tone-teal/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <CalendarClock className="size-4" aria-hidden />
      <span className="hidden min-[1360px]:inline">Book a call</span>
    </a>
  )
}
