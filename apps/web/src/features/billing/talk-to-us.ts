import type { Plan, PlanQuote } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { formatINR } from '@/shared/ui/format'
import { useHelp } from '@/features/help/api'
import { whatsappLink } from '@/features/help/support'
import { LEGAL } from '@/features/legal/legal'
import { planEnquiryMessage } from './plan-features'

/**
 * How a studio buys a plan for now: a message, then a call (owner, 10 Oct).
 * WhatsApp when the Help console has a support number, else email -- to the
 * console's address or, failing that, the one on the legal pages, so the
 * button always goes somewhere. The platform owner then gives the plan in
 * Studio Access Manager. Online checkout stays in the code for later.
 */
export function useTalkToUs() {
  const { session } = useAuth()
  const help = useHelp().data
  const studio = session?.studios.find((s) => s.company_id === session.company_id)?.company_name ?? 'my studio'
  const whatsapp = help?.support_whatsapp || null
  const email = help?.support_email || LEGAL.supportEmail

  return {
    via: whatsapp ? ('whatsapp' as const) : ('email' as const),
    label: whatsapp ? 'Talk to us on WhatsApp' : 'Email us',
    open(plan: Plan, kind?: PlanQuote['kind']) {
      const text = planEnquiryMessage({
        plan,
        kind,
        studio,
        name: session?.display_name ?? '',
        email: session?.email,
        inr: formatINR,
      })
      if (whatsapp) {
        window.open(whatsappLink(whatsapp, text), '_blank', 'noopener,noreferrer')
        return
      }
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(`${plan.name} plan for ${studio}`)}&body=${encodeURIComponent(text)}`
    },
  }
}
