import type { ComponentProps } from 'react'
import { CalendarClock } from 'lucide-react'
import { useAssistantState } from '@/features/assistant/api'
import { Button } from '@/shared/ui/button'

type ButtonProps = ComponentProps<typeof Button>

/**
 * The call link from the Help console (`support_call_url`, else the server's
 * ONBOARDING_CALL_URL). The server sends it only to whoever runs the studio --
 * owners, admins and managers -- so the team never sees it and keeps WhatsApp.
 */
export function useCallUrl(): string | null {
  return useAssistantState().data?.call_url ?? null
}

/**
 * Book a call: the one way to reach a person (owner, 19 Oct). It opens our
 * booking page in a new tab; that app takes the booking from there. Drawn
 * nowhere when there is no link or the person does not run the studio.
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
