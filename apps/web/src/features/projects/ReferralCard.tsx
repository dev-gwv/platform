import { Link } from '@tanstack/react-router'
import { Copy, Gift, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { buildWhatsAppUrl } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { useReferralCampaigns } from '@/features/referrals/api'

/**
 * "Ask for a referral" -- one small card on the project, not a tab.
 *
 * A happy client is the best time to ask, and asking is one message: the
 * reward and a link, sent on WhatsApp to their number. Only live campaigns
 * are offered (a paused one opens to "no longer active"), this project's own
 * first. Setting up rewards stays on the Referrals page.
 */
export function ReferralCard({
  projectId,
  projectName,
  clientName,
  clientPhone,
}: {
  projectId: string
  projectName: string
  clientName: string | null
  clientPhone: string | null
}) {
  const canSee = useAccess().hasModule('referrals')
  const { data } = useReferralCampaigns()
  if (!canSee) return null

  const live = (data?.campaigns ?? []).filter((c) => c.status === 'active')
  const campaign = live.find((c) => c.project_id === projectId) ?? live[0]

  // No live offer: nothing to ask for here. Setting one up lives on the
  // Referrals page, not on every project.
  if (!campaign) return null

  const reward =
    campaign.reward_title ??
    (campaign.reward_type === 'percentage'
      ? `${campaign.reward_value}% off`
      : campaign.reward_value > 0
        ? formatINR(campaign.reward_value)
        : (campaign.reward_description ?? 'a thank-you gift'))
  const url = `${window.location.origin}/refer/${campaign.slug}`
  const message = `Hi ${clientName ?? 'there'}! Loved working on ${projectName} with you. If a friend is looking for a photo/video team, share this link — they get ${reward}: ${url}`

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Gift className="size-4 text-tone-rose" aria-hidden /> Ask for a referral
        </p>
        <p className="text-sm text-muted-foreground">
          Reward: <span className="font-medium text-foreground">{reward}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <a href={buildWhatsAppUrl(clientPhone, message)} target="_blank" rel="noreferrer noopener">
              <MessageCircle /> WhatsApp {clientName ?? 'client'}
            </a>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(message)
                .then(() => toast.success('Message copied'))
                .catch(() => toast.error('Could not copy — select it by hand'))
            }
          >
            <Copy /> Copy message
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/referrals">Manage</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
