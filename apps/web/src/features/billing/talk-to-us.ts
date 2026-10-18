import type { Plan, PlanQuote } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { formatINR } from '@/shared/ui/format'
import { useHelp } from '@/features/help/api'
import { whatsappLink } from '@/features/help/support'
import { planEnquiryMessage } from './plan-features'

/** Our sales WhatsApp (owner, 14 Oct), used until /platform/help says otherwise. */
export const SALES_WHATSAPP = '919109192065'

/**
 * How a studio buys a plan for now: a WhatsApp message, then a call (owner,
 * 10 Oct). Always WhatsApp, never email (owner, 14 Oct: "put the WhatsApp
 * button, don't put the email button"): the Help console's support number, or
 * ours. The platform owner then gives the plan in Studio Access Manager.
 * Online checkout stays in the code for later.
 */
export function useTalkToUs() {
  const { session } = useAuth()
  const help = useHelp().data
  const studio = session?.studios.find((s) => s.company_id === session.company_id)?.company_name ?? 'my studio'
  const whatsapp = help?.support_whatsapp || SALES_WHATSAPP

  return {
    label: 'Talk to us on WhatsApp',
    open(plan: Plan, kind?: PlanQuote['kind'], diamond?: boolean, offer?: { percent: number; lastDay: string }) {
      const text = planEnquiryMessage({
        plan,
        kind,
        studio,
        name: session?.display_name ?? '',
        email: session?.email,
        inr: formatINR,
        diamond,
        offer,
      })
      window.open(whatsappLink(whatsapp, text), '_blank', 'noopener,noreferrer')
    },
  }
}
